// Abgleich zwischen der App und dem iCloud-/CalDAV-Kalender.
// - Termine aus dem Kalender werden als "nur lesen" in die App übernommen.
// - Termine aus der App werden in den gewählten Kalender geschrieben (UID …@manager.app)
//   und Änderungen am iPhone an diesen Terminen fließen zurück.
import { basicAuth, deleteEvent, eventUrl, fetchEvents, putEvent } from "./caldav.ts";
import { buildCalendar, parseCalendarData, type ParsedInstance } from "./ical.ts";
import { type Admin, readSecret } from "./supabase.ts";
import { errorMessage } from "./http.ts";

export const APP_UID_SUFFIX = "@manager.app";
const DAY = 86_400_000;

export interface StoredCalendar {
  href: string;
  name: string;
  color: string | null;
  readOnly: boolean;
  sync: boolean;
  area: "privat" | "beruflich";
}

export interface CalendarConnection {
  id: string;
  user_id: string;
  label: string;
  kind: string;
  server_url: string;
  username: string | null;
  home_url: string | null;
  calendars: StoredCalendar[];
  write_privat_href: string | null;
  write_beruflich_href: string | null;
  enabled: boolean;
}

export interface EventRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  area: "privat" | "beruflich";
  kind: string;
  source: string;
  status: string;
  reminder_minutes: number | null;
  cal_connection_id: string | null;
  cal_href: string | null;
  ext_uid: string | null;
  ext_href: string | null;
  ext_instance: string;
  ext_etag: string | null;
  sync_state: string;
  updated_at: string;
}

export async function connectionAuth(admin: Admin, conn: CalendarConnection): Promise<string | null> {
  if (!conn.username) return null;
  const password = await readSecret(admin, `cal:${conn.id}`);
  return password ? basicAuth(conn.username, password) : null;
}

export function writeTarget(conn: CalendarConnection, area: string): string | null {
  return area === "beruflich"
    ? conn.write_beruflich_href ?? conn.write_privat_href
    : conn.write_privat_href ?? conn.write_beruflich_href;
}

export async function loadConnections(admin: Admin, userId: string): Promise<CalendarConnection[]> {
  const { data, error } = await admin
    .from("calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .eq("kind", "caldav");
  if (error) throw new Error(`Kalender-Verbindungen: ${error.message}`);
  return (data ?? []) as CalendarConnection[];
}

function sameMinute(a: string | Date, b: string | Date): boolean {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;
}

async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

export interface PullResult {
  imported: number;
  removed: number;
  updatedFromPhone: number;
}

/** Reads the synced calendars of one connection for [-7 days, +120 days]. */
export async function pullConnection(
  admin: Admin,
  conn: CalendarConnection,
  auth: string,
  tz: string,
  now = new Date(),
): Promise<PullResult> {
  const rangeStart = new Date(now.getTime() - 7 * DAY);
  const rangeEnd = new Date(now.getTime() + 120 * DAY);
  const result: PullResult = { imported: 0, removed: 0, updatedFromPhone: 0 };

  for (const cal of conn.calendars.filter((c) => c.sync)) {
    const remote = await fetchEvents(cal.href, auth, rangeStart, rangeEnd);
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    const appOwned = new Map<string, { inst: ParsedInstance; href: string; etag: string | null }>();

    for (const res of remote) {
      let instances: ParsedInstance[];
      try {
        instances = parseCalendarData(res.ics, rangeStart, rangeEnd, tz);
      } catch (err) {
        console.error("Termin nicht lesbar", res.href, errorMessage(err));
        continue;
      }
      for (const inst of instances) {
        if (inst.uid.endsWith(APP_UID_SUFFIX)) {
          appOwned.set(inst.uid.slice(0, -APP_UID_SUFFIX.length), { inst, href: res.href, etag: res.etag });
          continue;
        }
        if (inst.cancelled) continue;
        const key = `${res.href}|${inst.instance}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          user_id: conn.user_id,
          title: inst.title,
          description: inst.description,
          location: inst.location,
          start_at: inst.start.toISOString(),
          end_at: inst.end.toISOString(),
          all_day: inst.allDay,
          area: cal.area ?? "privat",
          kind: "termin",
          source: "caldav",
          status: "confirmed",
          cal_connection_id: conn.id,
          cal_href: cal.href,
          ext_uid: inst.uid,
          ext_href: res.href,
          ext_instance: inst.instance,
          ext_etag: res.etag,
          sync_state: "readonly",
        });
      }
    }

    await chunked(rows, 200, async (chunk) => {
      const { error } = await admin.from("events").upsert(chunk, { onConflict: "cal_connection_id,ext_href,ext_instance" });
      if (error) throw new Error(`Termine speichern: ${error.message}`);
    });
    result.imported += rows.length;

    // Remove imported events that no longer exist in the calendar window
    const { data: existing, error: existingError } = await admin
      .from("events")
      .select("id, ext_href, ext_instance")
      .eq("cal_connection_id", conn.id)
      .eq("cal_href", cal.href)
      .eq("source", "caldav")
      .lt("start_at", rangeEnd.toISOString())
      .gt("end_at", rangeStart.toISOString());
    if (existingError) throw new Error(existingError.message);
    const stale = (existing ?? []).filter((e) => !seen.has(`${e.ext_href}|${e.ext_instance}`)).map((e) => e.id as string);
    await chunked(stale, 100, async (ids) => {
      await admin.from("events").delete().in("id", ids);
    });
    result.removed += stale.length;

    // App-owned events: take over changes made on the phone, mirror deletions
    const { data: ownRows } = await admin
      .from("events")
      .select("*")
      .eq("cal_connection_id", conn.id)
      .eq("cal_href", cal.href)
      .neq("source", "caldav")
      .in("sync_state", ["synced"])
      .lt("start_at", rangeEnd.toISOString())
      .gt("end_at", rangeStart.toISOString());
    for (const row of (ownRows ?? []) as EventRow[]) {
      const remoteVersion = appOwned.get(row.id);
      if (!remoteVersion) {
        await admin.from("events").delete().eq("id", row.id);
        result.removed++;
        continue;
      }
      const { inst, etag } = remoteVersion;
      const changed = !sameMinute(inst.start, row.start_at) || !sameMinute(inst.end, row.end_at) ||
        inst.title !== row.title || (inst.location ?? null) !== (row.location ?? null);
      if (changed) {
        await admin.from("events").update({
          title: inst.title,
          location: inst.location,
          start_at: inst.start.toISOString(),
          end_at: inst.end.toISOString(),
          all_day: inst.allDay,
          ext_etag: etag,
          sync_state: "synced",
        }).eq("id", row.id);
        result.updatedFromPhone++;
      }
    }
  }
  return result;
}

export interface PushResult {
  pushed: number;
  deleted: number;
  failed: number;
}

/** Writes new/changed app events to the calendar and removes deleted ones. */
export async function pushPending(admin: Admin, userId: string, tz: string): Promise<PushResult> {
  const result: PushResult = { pushed: 0, deleted: 0, failed: 0 };
  const retryBefore = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data, error } = await admin
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .or(`sync_state.in.(pending,delete),and(sync_state.eq.error,updated_at.lt.${retryBefore})`)
    .order("updated_at", { ascending: true })
    .limit(60);
  if (error) throw new Error(`Termine lesen: ${error.message}`);
  const rows = (data ?? []) as EventRow[];
  if (rows.length === 0) return result;

  const connections = await loadConnections(admin, userId);
  const auths = new Map<string, string | null>();
  const authFor = async (conn: CalendarConnection) => {
    if (!auths.has(conn.id)) auths.set(conn.id, await connectionAuth(admin, conn));
    return auths.get(conn.id) ?? null;
  };

  for (const row of rows) {
    const conn = connections.find((c) => c.id === row.cal_connection_id) ?? (row.cal_connection_id ? undefined : connections[0]);
    try {
      if (row.sync_state === "delete") {
        if (conn && row.ext_href) {
          const auth = await authFor(conn);
          if (auth) await deleteEvent(row.ext_href, auth);
        }
        await admin.from("events").delete().eq("id", row.id);
        result.deleted++;
        continue;
      }
      const href = conn ? row.cal_href ?? writeTarget(conn, row.area) : null;
      const auth = conn ? await authFor(conn) : null;
      if (!conn || !href || !auth) {
        await admin.from("events").update({ sync_state: "local", sync_error: null }).eq("id", row.id);
        continue;
      }
      const uid = row.ext_uid ?? `${row.id}${APP_UID_SUFFIX}`;
      const url = row.ext_href ?? eventUrl(href, uid);
      const ics = buildCalendar([{
        uid,
        title: row.title,
        description: row.description,
        location: row.location,
        start: new Date(row.start_at),
        end: new Date(row.end_at),
        allDay: row.all_day,
        reminderMinutes: row.reminder_minutes,
        status: row.status === "tentative" ? "TENTATIVE" : row.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
        lastModified: new Date(row.updated_at),
      }], tz);
      const saved = await putEvent(url, auth, ics, row.ext_etag);
      await admin.from("events").update({
        cal_connection_id: conn.id,
        cal_href: href,
        ext_uid: uid,
        ext_href: saved.href,
        ext_etag: saved.etag,
        sync_state: "synced",
        sync_error: null,
      }).eq("id", row.id);
      result.pushed++;
    } catch (err) {
      result.failed++;
      const message = errorMessage(err).slice(0, 300);
      // A failed deletion stays queued as "delete" so it is never re-created by a retry.
      const update = row.sync_state === "delete" ? { sync_error: message } : { sync_state: "error", sync_error: message };
      await admin.from("events").update(update).eq("id", row.id);
    }
  }
  return result;
}

/** Initial state for a new app event: pending when a calendar is connected. */
export async function initialSyncState(admin: Admin, userId: string, area: string): Promise<"pending" | "local"> {
  const connections = await loadConnections(admin, userId);
  return connections.some((c) => writeTarget(c, area)) ? "pending" : "local";
}
