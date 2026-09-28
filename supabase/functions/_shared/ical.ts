// iCalendar (ICS) erzeugen und lesen – für iCloud/CalDAV und das Kalender-Abo.
import ICAL from "npm:ical.js@2.2.1";
import { addDays, isValidTimeZone, localDate, zonedToUtc } from "./time.ts";

export interface CalEventInput {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  reminderMinutes?: number | null;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  categories?: string[];
  lastModified?: Date;
}

export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting UTF-8 characters (RFC 5545 3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = ch;
      size = len;
    } else {
      current += ch;
      size += len;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function veventLines(ev: CalEventInput, tz: string, now = new Date()): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${ev.uid}`, `DTSTAMP:${utcStamp(now)}`];
  if (ev.allDay) {
    const startDay = localDate(ev.start, tz);
    let endDay = localDate(ev.end, tz);
    if (endDay <= startDay) endDay = addDays(startDay, 1);
    lines.push(`DTSTART;VALUE=DATE:${startDay.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${endDay.replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART:${utcStamp(ev.start)}`, `DTEND:${utcStamp(ev.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.status) lines.push(`STATUS:${ev.status}`);
  if (ev.categories && ev.categories.length > 0) lines.push(`CATEGORIES:${ev.categories.map(escapeText).join(",")}`);
  if (ev.lastModified) lines.push(`LAST-MODIFIED:${utcStamp(ev.lastModified)}`);
  if (ev.reminderMinutes !== null && ev.reminderMinutes !== undefined && ev.reminderMinutes >= 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(ev.title)}`,
      `TRIGGER:-PT${Math.round(ev.reminderMinutes)}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(
  events: CalEventInput[],
  tz: string,
  opts: { name?: string; feed?: boolean } = {},
): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Manager//Organizer//DE", "CALSCALE:GREGORIAN"];
  if (opts.feed) {
    lines.push(
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(opts.name ?? "Manager")}`,
      `X-WR-TIMEZONE:${tz}`,
      "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
      "X-PUBLISHED-TTL:PT15M",
    );
  }
  for (const ev of events) lines.push(...veventLines(ev, tz));
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export interface ParsedInstance {
  uid: string;
  /** "" for single events, recurrence id for instances of a series */
  instance: string;
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  cancelled: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

// deno-lint-ignore no-explicit-any
type IcalTime = any;
// deno-lint-ignore no-explicit-any
type IcalProperty = any;

function toInstant(t: IcalTime, prop: IcalProperty | null, fallbackTz: string): { date: Date; allDay: boolean } {
  if (t.isDate) {
    return { date: zonedToUtc(`${t.year}-${pad(t.month)}-${pad(t.day)}`, fallbackTz), allDay: true };
  }
  const zone = t.zone;
  if (zone && zone !== ICAL.Timezone.localTimezone) {
    return { date: t.toJSDate(), allDay: false };
  }
  const tzid = prop?.getParameter?.("tzid") as string | undefined;
  const tz = tzid && isValidTimeZone(tzid) ? tzid : fallbackTz;
  const local = `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
  return { date: zonedToUtc(local, tz), allDay: false };
}

function textProp(component: { getFirstPropertyValue(name: string): unknown }, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Expands all events of an ICS document that overlap [rangeStart, rangeEnd). */
export function parseCalendarData(ics: string, rangeStart: Date, rangeEnd: Date, fallbackTz: string): ParsedInstance[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // ignore broken zone definitions
    }
  }
  const out: ParsedInstance[] = [];
  const vevents = root.getAllSubcomponents("vevent");
  const masters = vevents.filter((v: { hasProperty(n: string): boolean }) => !v.hasProperty("recurrence-id"));
  const hasMaster = new Set(
    masters.map((v: { getFirstPropertyValue(n: string): unknown }) => String(v.getFirstPropertyValue("uid"))),
  );

  const pushInstance = (
    uid: string,
    instance: string,
    component: { getFirstPropertyValue(n: string): unknown; getFirstProperty(n: string): IcalProperty },
    start: IcalTime,
    end: IcalTime,
  ) => {
    const s = toInstant(start, component.getFirstProperty("dtstart"), fallbackTz);
    const e = toInstant(end, component.getFirstProperty("dtend") ?? component.getFirstProperty("dtstart"), fallbackTz);
    let endDate = e.date;
    if (endDate <= s.date) endDate = new Date(s.date.getTime() + (s.allDay ? 86_400_000 : 3_600_000));
    if (s.date >= rangeEnd || endDate <= rangeStart) return;
    out.push({
      uid,
      instance,
      title: textProp(component, "summary") ?? "(ohne Titel)",
      description: textProp(component, "description"),
      location: textProp(component, "location"),
      start: s.date,
      end: endDate,
      allDay: s.allDay,
      cancelled: (textProp(component, "status") ?? "").toUpperCase() === "CANCELLED",
    });
  };

  for (const master of masters) {
    const event = new ICAL.Event(master);
    const uid = String(event.uid ?? master.getFirstPropertyValue("uid") ?? crypto.randomUUID());
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      pushInstance(uid, "", master, event.startDate, event.endDate ?? event.startDate);
      continue;
    }
    const iterator = event.iterator();
    let next: IcalTime;
    let guard = 0;
    while ((next = iterator.next()) && guard++ < 20_000) {
      const details = event.getOccurrenceDetails(next);
      const probe = toInstant(details.startDate, master.getFirstProperty("dtstart"), fallbackTz);
      if (probe.date >= rangeEnd) break;
      pushInstance(uid, details.recurrenceId.toString(), details.item.component, details.startDate, details.endDate);
    }
  }

  // Changed occurrences whose series master is not part of this document
  for (
    const orphan of vevents.filter((v: { hasProperty(n: string): boolean; getFirstPropertyValue(n: string): unknown }) =>
      v.hasProperty("recurrence-id") && !hasMaster.has(String(v.getFirstPropertyValue("uid")))
    )
  ) {
    const event = new ICAL.Event(orphan);
    pushInstance(
      String(event.uid),
      String(orphan.getFirstPropertyValue("recurrence-id")),
      orphan,
      event.startDate,
      event.endDate ?? event.startDate,
    );
  }

  return out;
}
