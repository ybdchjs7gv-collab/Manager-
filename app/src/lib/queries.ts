// Wiederverwendete Abfragen.
import { addDaysStr, atMinutes } from "./dates";
import { db } from "./db";
import type { CalEvent, Chore, Email, MealPlanEntry, Task, Workout, WorkoutLog } from "./types";

export async function eventsBetween(fromDay: string, toDayExclusive: string): Promise<CalEvent[]> {
  const start = atMinutes(fromDay, 0).toISOString();
  const end = atMinutes(toDayExclusive, 0).toISOString();
  return db().list("events", {
    where: [["start_at", "lt", end], ["end_at", "gt", start], ["sync_state", "neq", "delete"], ["status", "neq", "cancelled"]],
    order: [["start_at", "asc"]],
    limit: 1000,
  });
}

export async function eventsOnDay(day: string): Promise<CalEvent[]> {
  return eventsBetween(day, addDaysStr(day, 1));
}

export async function openTasks(): Promise<Task[]> {
  return db().list("tasks", { where: [["status", "in", ["offen", "geplant"]]], order: [["due_date", "asc"], ["priority", "desc"]], limit: 500 });
}

export async function activeChores(): Promise<Chore[]> {
  return db().list("chores", { where: [["active", "eq", true]], order: [["next_due", "asc"]] });
}

export async function activeWorkouts(): Promise<Workout[]> {
  return db().list("workouts", { where: [["active", "eq", true]], order: [["created_at", "asc"]] });
}

export async function workoutLogs(fromDay: string, toDay: string): Promise<WorkoutLog[]> {
  return db().list("workout_logs", { where: [["day", "gte", fromDay], ["day", "lte", toDay]] });
}

export async function mealsBetween(fromDay: string, toDay: string): Promise<MealPlanEntry[]> {
  return db().list("meal_plan", { where: [["day", "gte", fromDay], ["day", "lte", toDay]], order: [["day", "asc"]] });
}

const JUNK = ["newsletter", "werbung", "spam"];

export function isJunk(e: Email): boolean {
  return JUNK.includes(e.category ?? "");
}

export function isImportant(e: Email): boolean {
  return !isJunk(e) && (e.priority >= 2 || e.needs_reply);
}

export async function inboxEmails(): Promise<Email[]> {
  return db().list("emails", {
    where: [["status", "in", ["neu", "gelesen"]]],
    order: [["sent_at", "desc"]],
    limit: 400,
  });
}
