// Termine und Aufgaben aus KI-Ergebnissen anlegen (mit Doppelt-Schutz).
import { initialSyncState } from "./calsync.ts";
import type { Admin } from "./supabase.ts";
import { addDays, zonedToUtc } from "./time.ts";

export interface AiEvent {
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
  location: string | null;
  confidence?: string;
}

export interface AiTask {
  title: string;
  due_date: string | null;
  duration_min: number;
}

export interface Origin {
  area: "privat" | "beruflich";
  source: "email" | "whatsapp" | "ai" | "manual";
  sourceRef: string | null;
  description?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Converts an AI event (local wall-clock strings) into absolute start/end. */
export function resolveEventTimes(ev: AiEvent, tz: string): { start: Date; end: Date; allDay: boolean } | null {
  if (!ev.start || !DATE_RE.test(ev.start)) return null;
  try {
    const allDay = ev.all_day || ev.start.length <= 10;
    if (allDay) {
      const firstDay = ev.start.slice(0, 10);
      const lastDay = ev.end && DATE_RE.test(ev.end) ? ev.end.slice(0, 10) : firstDay;
      const endExclusive = addDays(lastDay >= firstDay ? lastDay : firstDay, 1);
      return { start: zonedToUtc(firstDay, tz), end: zonedToUtc(endExclusive, tz), allDay: true };
    }
    const start = zonedToUtc(ev.start, tz);
    let end = ev.end && DATE_RE.test(ev.end) ? zonedToUtc(ev.end, tz) : new Date(start.getTime() + 60 * 60_000);
    if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 60 * 60_000);
    return { start, end, allDay: false };
  } catch {
    return null;
  }
}

export async function createEvents(
  admin: Admin,
  userId: string,
  tz: string,
  items: AiEvent[],
  origin: Origin,
): Promise<string[]> {
  const created: string[] = [];
  if (items.length === 0) return created;
  const syncState = await initialSyncState(admin, userId, origin.area);
  for (const ev of items) {
    const times = resolveEventTimes(ev, tz);
    if (!times) continue;
    const title = ev.title.trim().slice(0, 200) || "Termin";
    let duplicate = admin
      .from("events")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .gte("start_at", new Date(times.start.getTime() - 60_000).toISOString())
      .lte("start_at", new Date(times.start.getTime() + 60_000).toISOString())
      .limit(1);
    if (origin.sourceRef) duplicate = duplicate.eq("source_ref", origin.sourceRef);
    const { data: existing } = await duplicate;
    if (existing && existing.length > 0) continue;
    const { data, error } = await admin
      .from("events")
      .insert({
        user_id: userId,
        title,
        description: origin.description ?? null,
        location: ev.location,
        start_at: times.start.toISOString(),
        end_at: times.end.toISOString(),
        all_day: times.allDay,
        area: origin.area,
        kind: "termin",
        source: origin.source,
        source_ref: origin.sourceRef,
        status: ev.confidence && ev.confidence !== "hoch" ? "tentative" : "confirmed",
        reminder_minutes: times.allDay ? null : 30,
        sync_state: syncState,
      })
      .select("id")
      .single();
    if (error) {
      console.error("Termin nicht angelegt", error.message);
      continue;
    }
    created.push(data.id as string);
  }
  return created;
}

export async function createTasks(admin: Admin, userId: string, items: AiTask[], origin: Origin): Promise<number> {
  let count = 0;
  for (const t of items) {
    const title = t.title.trim().slice(0, 200);
    if (!title) continue;
    let duplicate = admin.from("tasks").select("id").eq("user_id", userId).eq("title", title).neq("status", "erledigt").limit(1);
    if (origin.sourceRef) duplicate = duplicate.eq("source_ref", origin.sourceRef);
    const { data: existing } = await duplicate;
    if (existing && existing.length > 0) continue;
    const { error } = await admin.from("tasks").insert({
      user_id: userId,
      title,
      notes: origin.description ?? null,
      area: origin.area,
      priority: 2,
      duration_min: Math.min(Math.max(Math.round(t.duration_min || 30), 5), 600),
      due_date: t.due_date && DATE_RE.test(t.due_date) ? t.due_date.slice(0, 10) : null,
      source: origin.source,
      source_ref: origin.sourceRef,
    });
    if (!error) count++;
  }
  return count;
}
