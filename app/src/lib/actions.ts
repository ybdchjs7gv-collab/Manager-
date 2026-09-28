// Häufige Änderungen an den Daten – überall gleich, inkl. Kalender-Abgleich.
import { db } from "./db";
import { addDaysStr, todayStr } from "./dates";
import { invalidate } from "./hooks";
import { guessCategory, mergeQuantities } from "./shopping";
import type { Area, CalEvent, Chore, Email, Ingredient, ShoppingItem, Task } from "./types";

// ---------------------------------------------------------------------------
// Kalender
// ---------------------------------------------------------------------------

let pushTimer: ReturnType<typeof setTimeout> | undefined;

/** Sends new/changed events to the iPhone calendar shortly after a change. */
export function schedulePush(): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    db().invoke("calendar-sync", { action: "push" })
      .then(() => invalidate("events"))
      .catch(() => undefined);
  }, 1500);
}

async function calendarConnected(area: Area): Promise<boolean> {
  const conns = await db().list("calendar_connections", { where: [["enabled", "eq", true]] });
  return conns.some((c) => (area === "beruflich" ? c.write_beruflich_href ?? c.write_privat_href : c.write_privat_href ?? c.write_beruflich_href));
}

export type EventDraft = Pick<CalEvent, "title" | "start_at" | "end_at"> & Partial<CalEvent>;

export async function createEvents(drafts: EventDraft[]): Promise<CalEvent[]> {
  if (drafts.length === 0) return [];
  const connected = { privat: await calendarConnected("privat"), beruflich: await calendarConnected("beruflich") };
  const rows = drafts.map((d) => {
    const area = d.area ?? "privat";
    return { reminder_minutes: d.all_day ? null : 15, ...d, area, sync_state: connected[area] ? "pending" as const : "local" as const };
  });
  const created = await db().insert("events", rows);
  invalidate("events");
  if (created.some((e) => e.sync_state === "pending")) schedulePush();
  return created;
}

export async function updateEvent(event: CalEvent, patch: Partial<CalEvent>): Promise<void> {
  if (event.source === "caldav") throw new Error("Dieser Termin kommt aus deinem iPhone-Kalender und wird dort geändert.");
  const area = patch.area ?? event.area;
  const connected = await calendarConnected(area);
  const syncState = connected || event.sync_state === "synced" ? "pending" : "local";
  await db().update("events", [["id", "eq", event.id]], { ...patch, sync_state: syncState, sync_error: null });
  invalidate("events");
  if (syncState === "pending") schedulePush();
}

export async function deleteEvent(event: CalEvent): Promise<void> {
  if (event.source === "caldav") throw new Error("Dieser Termin kommt aus deinem iPhone-Kalender und wird dort gelöscht.");
  if (event.ext_href) {
    await db().update("events", [["id", "eq", event.id]], { sync_state: "delete" });
    schedulePush();
  } else {
    await db().remove("events", [["id", "eq", event.id]]);
  }
  if (event.ref_table === "tasks" && event.ref_id) {
    await db().update("tasks", [["id", "eq", event.ref_id], ["status", "eq", "geplant"]], { status: "offen", event_id: null });
    invalidate("tasks");
  }
  invalidate("events");
}

/** Removes several app events (e.g. when re-planning a day). */
export async function deleteEvents(events: CalEvent[]): Promise<void> {
  const synced = events.filter((e) => e.ext_href).map((e) => e.id);
  const local = events.filter((e) => !e.ext_href).map((e) => e.id);
  if (synced.length > 0) await db().update("events", [["id", "in", synced]], { sync_state: "delete" });
  if (local.length > 0) await db().remove("events", [["id", "in", local]]);
  if (synced.length > 0) schedulePush();
  invalidate("events");
}

// ---------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------

export async function addTask(task: Partial<Task> & { title: string }): Promise<Task> {
  const [created] = await db().insert("tasks", [{ area: "privat", priority: 2, duration_min: 30, ...task }]);
  invalidate("tasks");
  return created;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  await db().update("tasks", [["id", "eq", id]], patch);
  invalidate("tasks");
}

export async function setTaskDone(task: Task, done: boolean): Promise<void> {
  await db().update("tasks", [["id", "eq", task.id]], {
    status: done ? "erledigt" : task.event_id ? "geplant" : "offen",
    completed_at: done ? new Date().toISOString() : null,
  });
  if (task.event_id) {
    await db().update("events", [["id", "eq", task.event_id], ["source", "eq", "planner"]], { status: done ? "done" : "confirmed" });
    invalidate("events");
  }
  invalidate("tasks");
}

export async function deleteTask(task: Task): Promise<void> {
  await db().remove("tasks", [["id", "eq", task.id]]);
  invalidate("tasks");
}

// ---------------------------------------------------------------------------
// Haushalt & Sport
// ---------------------------------------------------------------------------

export async function markChoreDone(chore: Chore): Promise<void> {
  await db().update("chores", [["id", "eq", chore.id]], {
    last_done_at: new Date().toISOString(),
    next_due: addDaysStr(todayStr(), chore.interval_days),
  });
  invalidate("chores");
}

export async function toggleWorkoutDone(workoutId: string, title: string, durationMin: number, day: string, done: boolean): Promise<void> {
  if (done) {
    await db().insertIgnoreDuplicates("workout_logs", [{ workout_id: workoutId, title, duration_min: durationMin, day, done: true }], "workout_id,day");
  } else {
    await db().remove("workout_logs", [["workout_id", "eq", workoutId], ["day", "eq", day]]);
  }
  invalidate("workout_logs");
}

// ---------------------------------------------------------------------------
// Einkaufsliste
// ---------------------------------------------------------------------------

export async function addShoppingItems(items: { name: string; quantity?: string | null; category?: string | null; source?: string; recipe_id?: string | null }[]): Promise<number> {
  if (items.length === 0) return 0;
  const open = await db().list("shopping_items", { where: [["checked", "eq", false]] });
  const byName = new Map(open.map((i) => [i.name.toLowerCase(), i] as const));
  const fresh: Partial<ShoppingItem>[] = [];
  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      await db().update("shopping_items", [["id", "eq", existing.id]], { quantity: mergeQuantities(existing.quantity, item.quantity ?? null) });
      continue;
    }
    const row = { name, quantity: item.quantity ?? null, category: item.category || guessCategory(name), source: item.source ?? "manual", recipe_id: item.recipe_id ?? null };
    fresh.push(row);
    byName.set(name.toLowerCase(), row as ShoppingItem);
  }
  if (fresh.length > 0) await db().insert("shopping_items", fresh);
  invalidate("shopping_items");
  return items.length;
}

export function ingredientsToItems(ingredients: Ingredient[], recipeId: string | null) {
  return ingredients.map((i) => ({
    name: i.name,
    quantity: [i.amount, i.unit].filter((x) => x && x !== "0").join(" ") || null,
    category: i.category,
    source: "meal_plan",
    recipe_id: recipeId,
  }));
}

// ---------------------------------------------------------------------------
// E-Mail
// ---------------------------------------------------------------------------

export async function setEmailStatus(emails: Email[], status: Email["status"]): Promise<void> {
  await db().update("emails", [["id", "in", emails.map((e) => e.id)]], { status });
  invalidate("emails");
}

export async function deleteEmails(emails: Email[]): Promise<{ deleted: number; errors: string[] }> {
  const result = await db().invoke<{ deleted: number; errors: string[] }>("mail-action", { action: "delete", email_ids: emails.map((e) => e.id) });
  invalidate("emails");
  return result;
}

export async function markEmailsRead(emails: Email[], read: boolean): Promise<void> {
  await db().invoke("mail-action", { action: "mark", email_ids: emails.map((e) => e.id), read });
  invalidate("emails");
}
