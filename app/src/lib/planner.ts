// Tagesplaner: verteilt Aufgaben, Sport, Kochen, Haushalt und Einkauf auf freie Zeiten.
// Reine Logik ohne Datenbank – dadurch testbar und auch ohne KI nutzbar.
//
// Grundsätze:
// - Feste Termine (inkl. Puffer), Mittagspause und Abendessen sind tabu.
// - Kochen liegt direkt vor dem Essen, Sport in der Wunsch-Tageszeit, nie in der Arbeitszeit.
// - Berufliche Aufgaben kommen in die Arbeitszeit, private davor oder danach.
// - Dringendes (überfällig, heute fällig, hohe Wichtigkeit) wird zuerst eingeplant.
// - Nicht dringende private Aufgaben bekommen pro Tag nur ein begrenztes Zeitbudget und landen
//   bei mehreren Tagen dort, wo am meisten Luft ist – damit Freizeit übrig bleibt.
import { atMinutes, diffDays, isoWeekday, minutesOnDay, timeToMinutes, toDateStr } from "./dates";

export type TimePref = "morgens" | "mittags" | "abends" | "egal";
export type Area = "privat" | "beruflich";

export interface PlannerSettings {
  dayStart: string;
  dayEnd: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  lunchStart: string | null;
  lunchMinutes: number;
  dinnerTime: string | null;
  bufferMinutes: number;
  maxBlockMinutes: number;
  workoutTime: TimePref;
  choreTime: TimePref;
  /** Budget for non-urgent private tasks on work days (minutes). */
  flexMinutesWorkday?: number;
  /** Budget for non-urgent private tasks on free days (minutes). */
  flexMinutesFreeDay?: number;
}

export interface BusyInterval {
  start: Date;
  end: Date;
  allDay?: boolean;
}

export interface PlanTask {
  id: string;
  title: string;
  area: Area;
  priority: 1 | 2 | 3;
  durationMin: number;
  dueDate: string | null;
}

export interface PlanWorkout {
  id: string;
  title: string;
  durationMin: number;
  preferredTime: TimePref;
}

export interface PlanChore {
  id: string;
  title: string;
  durationMin: number;
  preferredTime: TimePref;
}

export interface PlanMeal {
  id: string;
  title: string;
  prepMin: number;
  meal: "fruehstueck" | "mittag" | "abend" | "snack";
}

export interface PlanRef {
  table: "tasks" | "chores" | "workouts" | "meal_plan";
  id: string;
}

export type BlockKind = "aufgabe" | "sport" | "kochen" | "haushalt" | "einkauf";

export interface PlannedBlock {
  title: string;
  start: Date;
  end: Date;
  kind: BlockKind;
  area: Area;
  ref?: PlanRef;
}

export interface Unscheduled {
  title: string;
  reason: string;
  ref?: PlanRef;
}

export interface DayInput {
  date: string;
  busy: BusyInterval[];
  workouts: PlanWorkout[];
  /** Chores that are due on this day (may repeat on later days – they are planned once). */
  chores: PlanChore[];
  meals: PlanMeal[];
  shopping: { items: number; durationMin: number } | null;
}

export interface DayPlan {
  date: string;
  blocks: PlannedBlock[];
  unscheduled: Unscheduled[];
  freeMinutes: number;
  busyMinutes: number;
  plannedMinutes: number;
}

type Interval = [number, number];

const STEP = 5;
const MIN_CHUNK = 25;
const ceilStep = (m: number) => Math.ceil(m / STEP) * STEP;
const floorStep = (m: number) => Math.floor(m / STEP) * STEP;

export function subtract(free: Interval[], [s, e]: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [fs, fe] of free) {
    if (e <= fs || s >= fe) {
      out.push([fs, fe]);
      continue;
    }
    if (s > fs) out.push([fs, s]);
    if (e < fe) out.push([e, fe]);
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      const s = Math.max(as, bs);
      const e = Math.min(ae, be);
      if (e > s) out.push([s, e]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function total(intervals: Interval[]): number {
  return intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** Earliest (or latest) start inside one of the windows (tried in order) where `duration` fits. */
export function findSlot(free: Interval[], duration: number, windows: Interval[], mode: "earliest" | "latest" = "earliest"): number | null {
  for (const window of windows) {
    const candidates = intersect(free, [window]);
    if (mode === "earliest") {
      for (const [s, e] of candidates) {
        const start = ceilStep(s);
        if (start + duration <= e) return start;
      }
    } else {
      for (let i = candidates.length - 1; i >= 0; i--) {
        const [s, e] = candidates[i];
        const start = floorStep(e - duration);
        if (start >= s) return start;
      }
    }
  }
  return null;
}

function largestFit(free: Interval[], windows: Interval[]): number {
  let best = 0;
  for (const [s, e] of intersect(free, windows)) best = Math.max(best, floorStep(e) - ceilStep(s));
  return best;
}

export function prefWindow(pref: TimePref, dayStart: number, dayEnd: number): Interval {
  switch (pref) {
    case "morgens":
      return [dayStart, 10 * 60];
    case "mittags":
      return [11 * 60 + 30, 14 * 60 + 30];
    case "abends":
      return [17 * 60, dayEnd];
    default:
      return [dayStart, dayEnd];
  }
}

export function urgency(task: PlanTask, date: string): number {
  if (!task.dueDate) return 0;
  const days = diffDays(task.dueDate, date);
  if (days < 0) return 60;
  if (days === 0) return 50;
  if (days === 1) return 30;
  if (days <= 3) return 15;
  if (days <= 7) return 5;
  return 0;
}

export function taskScore(task: PlanTask, date: string): number {
  return task.priority * 10 + urgency(task, date);
}

/** Must be done on this day: overdue, due today or marked as very important. */
function isUrgentOn(task: PlanTask, date: string): boolean {
  return task.priority === 3 || (task.dueDate !== null && task.dueDate <= date);
}

// ---------------------------------------------------------------------------
// Ein Tag mit seinen freien Zeiten
// ---------------------------------------------------------------------------

interface TaskPart {
  taskId: string;
  block: PlannedBlock;
}

/**
 * flex: nicht dringend – private Aufgaben nur im Tagesbudget
 * deadline: muss bis zur Frist erledigt sein – ohne Budget, berufliches nur in der Arbeitszeit
 * urgent: überfällig/heute fällig/sehr wichtig – notfalls auch berufliches am freien Tag
 */
type PlaceMode = "flex" | "deadline" | "urgent";

class DayState {
  readonly date: string;
  free: Interval[];
  readonly blocks: PlannedBlock[] = [];
  readonly unscheduled: Unscheduled[] = [];
  readonly busyMinutes: number;
  readonly isWorkDay: boolean;
  private readonly work: Interval[];
  readonly privateWindows: Interval[];
  private readonly dayStart: number;
  private readonly dayEnd: number;
  private readonly buffer: number;
  readonly maxBlock: number;
  private readonly lunch: number | null;
  private readonly dinner: number | null;
  private readonly flexCap: number;
  private flexUsed = 0;
  private readonly settings: PlannerSettings;

  constructor(input: DayInput, settings: PlannerSettings, now?: Date) {
    this.settings = settings;
    this.date = input.date;
    this.buffer = Math.max(0, settings.bufferMinutes);
    this.maxBlock = Math.max(MIN_CHUNK, settings.maxBlockMinutes);
    this.dayStart = timeToMinutes(settings.dayStart, 7 * 60);
    this.dayEnd = timeToMinutes(settings.dayEnd, 22 * 60);
    const workStart = timeToMinutes(settings.workStart, 8 * 60 + 30);
    const workEnd = timeToMinutes(settings.workEnd, 17 * 60);

    let earliest = this.dayStart;
    if (now && toDateStr(now) === input.date) {
      earliest = Math.max(this.dayStart, ceilStep(now.getHours() * 60 + now.getMinutes() + 10));
    }
    let free: Interval[] = earliest < this.dayEnd ? [[earliest, this.dayEnd]] : [];

    let busy = 0;
    for (const b of input.busy) {
      if (b.allDay) continue;
      const s = minutesOnDay(b.start, input.date);
      const e = minutesOnDay(b.end, input.date);
      if (e <= s) continue;
      busy += Math.max(0, Math.min(e, this.dayEnd) - Math.max(s, this.dayStart));
      free = subtract(free, [s - this.buffer, e + this.buffer]);
    }
    this.busyMinutes = busy;

    this.lunch = settings.lunchStart ? timeToMinutes(settings.lunchStart) : null;
    if (this.lunch !== null && settings.lunchMinutes > 0) free = subtract(free, [this.lunch, this.lunch + settings.lunchMinutes]);
    this.dinner = settings.dinnerTime ? timeToMinutes(settings.dinnerTime) : null;
    if (this.dinner !== null) free = subtract(free, [this.dinner, this.dinner + 30]);
    this.free = free;

    this.isWorkDay = settings.workDays.includes(isoWeekday(input.date));
    this.work = this.isWorkDay && workEnd > workStart ? [[workStart, workEnd]] : [];
    this.privateWindows = this.isWorkDay
      ? ([[this.dayStart, workStart], [workEnd, this.dayEnd]] as Interval[]).filter(([s, e]) => e > s)
      : [[this.dayStart, this.dayEnd]];
    this.flexCap = this.isWorkDay ? settings.flexMinutesWorkday ?? 120 : settings.flexMinutesFreeDay ?? 240;
  }

  private take(start: number, duration: number, block: Omit<PlannedBlock, "start" | "end">): PlannedBlock {
    const planned = { ...block, start: atMinutes(this.date, start), end: atMinutes(this.date, start + duration) };
    this.blocks.push(planned);
    this.free = subtract(this.free, [start, start + duration + this.buffer]);
    return planned;
  }

  private prefWindows(pref: TimePref): Interval[] {
    return [...intersect([prefWindow(pref, this.dayStart, this.dayEnd)], this.privateWindows), ...this.privateWindows];
  }

  placeMeal(meal: PlanMeal): void {
    if (meal.prepMin <= 0) return;
    if (meal.meal === "mittag" && this.isWorkDay) return;
    const target = meal.meal === "mittag" ? this.lunch ?? 12 * 60 + 30 : meal.meal === "abend" ? this.dinner ?? 18 * 60 + 30 : null;
    if (target === null) return;
    const title = `Kochen: ${meal.title}`;
    const ref: PlanRef = { table: "meal_plan", id: meal.id };
    const slot = findSlot(this.free, meal.prepMin, [[target - meal.prepMin - 90, target]], "latest");
    if (slot === null) this.unscheduled.push({ title, reason: "Vor dem Essen ist keine Zeit frei", ref });
    else this.take(slot, meal.prepMin, { title, kind: "kochen", area: "privat", ref });
  }

  placeWorkout(w: PlanWorkout): void {
    const pref = w.preferredTime !== "egal" ? w.preferredTime : this.settings.workoutTime;
    const ref: PlanRef = { table: "workouts", id: w.id };
    const slot = findSlot(this.free, w.durationMin, this.prefWindows(pref));
    if (slot === null) this.unscheduled.push({ title: w.title, reason: "Kein freies Zeitfenster für Sport", ref });
    else this.take(slot, w.durationMin, { title: w.title, kind: "sport", area: "privat", ref });
  }

  placeChore(chore: PlanChore): boolean {
    const pref = chore.preferredTime !== "egal" ? chore.preferredTime : this.settings.choreTime;
    const slot = findSlot(this.free, chore.durationMin, this.prefWindows(pref));
    if (slot === null) return false;
    this.take(slot, chore.durationMin, { title: chore.title, kind: "haushalt", area: "privat", ref: { table: "chores", id: chore.id } });
    return true;
  }

  placeShopping(items: number, durationMin: number): boolean {
    const windows: Interval[] = this.isWorkDay
      ? intersect([[timeToMinutes(this.settings.workEnd, 17 * 60), Math.min(this.dayEnd, 20 * 60)]], this.privateWindows)
      : [[Math.max(this.dayStart, 9 * 60), Math.min(this.dayEnd, 19 * 60)]];
    const slot = findSlot(this.free, durationMin, windows);
    if (slot === null) return false;
    this.take(slot, durationMin, { title: `Einkaufen (${items} Artikel)`, kind: "einkauf", area: "privat" });
    return true;
  }

  private taskWindows(task: PlanTask, mode: PlaceMode): Interval[] {
    if (task.area === "beruflich") return this.isWorkDay ? this.work : mode === "urgent" ? this.privateWindows : [];
    return this.privateWindows;
  }

  /** Free minutes within the task's windows (ignoring the daily budget). */
  freeFor(task: PlanTask, mode: PlaceMode): number {
    const windows = this.taskWindows(task, mode);
    if (windows.length === 0) return 0;
    return intersect(this.free, windows).reduce((sum, [s, e]) => sum + Math.max(0, floorStep(e) - ceilStep(s)), 0);
  }

  /** Minutes this day could still take for the task (free time within its windows and budget). */
  capacity(task: PlanTask, mode: PlaceMode): number {
    const free = this.freeFor(task, mode);
    if (task.area === "privat" && mode === "flex") return Math.min(free, Math.max(0, this.flexCap - this.flexUsed));
    return free;
  }

  canUseArea(task: PlanTask, mode: PlaceMode): boolean {
    return this.taskWindows(task, mode).length > 0;
  }

  /** Places up to `minutes` of the task in chunks; returns the planned parts. */
  placeTask(task: PlanTask, minutes: number, mode: PlaceMode): TaskPart[] {
    const windows = this.taskWindows(task, mode);
    if (windows.length === 0) return [];
    const budgeted = task.area === "privat" && mode === "flex";
    let budget = budgeted ? Math.min(minutes, Math.max(0, this.flexCap - this.flexUsed)) : minutes;
    const parts: TaskPart[] = [];
    while (budget > 0 && budget >= Math.min(MIN_CHUNK, minutes)) {
      let chunk = Math.min(budget, this.maxBlock);
      let slot = findSlot(this.free, chunk, windows);
      if (slot === null) {
        const fit = largestFit(this.free, windows);
        if (fit < MIN_CHUNK || fit >= chunk) break;
        chunk = fit;
        slot = findSlot(this.free, chunk, windows);
        if (slot === null) break;
      }
      const block = this.take(slot, chunk, { title: task.title, kind: "aufgabe", area: task.area, ref: { table: "tasks", id: task.id } });
      parts.push({ taskId: task.id, block });
      budget -= chunk;
      if (budgeted) this.flexUsed += chunk;
    }
    return parts;
  }

  result(): DayPlan {
    this.blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
    const plannedMinutes = this.blocks.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 60_000, 0);
    return {
      date: this.date,
      blocks: this.blocks,
      unscheduled: this.unscheduled,
      freeMinutes: total(this.free),
      busyMinutes: this.busyMinutes,
      plannedMinutes,
    };
  }
}

// ---------------------------------------------------------------------------
// Mehrere Tage planen
// ---------------------------------------------------------------------------

/** Plans one or more consecutive days. Every task, chore and shopping trip is planned at most once. */
export function planDays(days: DayInput[], tasks: PlanTask[], settings: PlannerSettings, now?: Date): DayPlan[] {
  if (days.length === 0) return [];
  const states = days.map((d) => new DayState(d, settings, now));
  const firstDay = days[0].date;

  // 1. Feste Anker: Kochen und Sport
  days.forEach((d, i) => {
    d.meals.forEach((m) => states[i].placeMeal(m));
    d.workouts.forEach((w) => states[i].placeWorkout(w));
  });

  const remaining = new Map(tasks.map((t) => [t.id, t.durationMin]));
  const allParts: TaskPart[] = [];
  const sorted = [...tasks].sort((a, b) => taskScore(b, firstDay) - taskScore(a, firstDay) || a.durationMin - b.durationMin);
  const indices = days.map((_, i) => i);
  const placeAcross = (task: PlanTask, order: number[], mode: (dayIndex: number) => PlaceMode) => {
    for (const i of order) {
      const left = remaining.get(task.id) ?? 0;
      if (left <= 0) return;
      const parts = states[i].placeTask(task, left, mode(i));
      allParts.push(...parts);
      remaining.set(task.id, left - parts.reduce((sum, p) => sum + minutesOf(p.block), 0));
    }
  };
  const urgentOn = (task: PlanTask) => (i: number): PlaceMode => (isUrgentOn(task, days[i].date) ? "urgent" : "deadline");

  // 2. Dringendes zuerst und so früh wie möglich
  for (const task of sorted) {
    if (isUrgentOn(task, firstDay)) placeAcross(task, indices, urgentOn(task));
  }

  // 3. Haushalt: am ersten Tag, an dem die Aufgabe fällig ist und Platz hat
  const placedChores = new Set<string>();
  const choreLastDue = new Map<string, { chore: PlanChore; lastDay: number }>();
  days.forEach((d, i) => {
    for (const chore of d.chores) {
      if (placedChores.has(chore.id)) continue;
      choreLastDue.set(chore.id, { chore, lastDay: i });
      if (states[i].placeChore(chore)) placedChores.add(chore.id);
    }
  });
  for (const [id, { chore, lastDay }] of choreLastDue) {
    if (!placedChores.has(id)) states[lastDay].unscheduled.push({ title: chore.title, reason: "Keine Zeit mehr für Haushalt", ref: { table: "chores", id } });
  }

  // 4. Einkaufen: einmal, am ersten Tag mit Platz
  const shoppingDays = days.map((d, i) => ({ d, i })).filter(({ d }) => d.shopping && d.shopping.items > 0);
  if (shoppingDays.length > 0) {
    const placed = shoppingDays.some(({ d, i }) => states[i].placeShopping(d.shopping!.items, d.shopping!.durationMin));
    if (!placed) {
      const last = shoppingDays[shoppingDays.length - 1];
      states[last.i].unscheduled.push({ title: `Einkaufen (${last.d.shopping!.items} Artikel)`, reason: "Keine Zeit zum Einkaufen" });
    }
  }

  // 5. Übriges an die Tage mit der meisten Luft verteilen (bis zur Fälligkeit, mit Tagesbudget)
  const beforeDue = (task: PlanTask) => {
    const within = indices.filter((i) => !task.dueDate || days[i].date <= task.dueDate);
    return within.length > 0 ? within : [0];
  };
  // Bevorzugt: Tage, die die ganze Aufgabe im Budget schaffen, dann die mit der meisten freien Zeit.
  // Jeder Tag Aufschub kostet 30 Minuten "Luft" – so wird nichts ohne Grund nach hinten geschoben.
  for (const task of sorted) {
    const left = remaining.get(task.id) ?? 0;
    if (left <= 0) continue;
    const score = (i: number) => states[i].freeFor(task, "flex") - i * 30;
    const fits = (i: number) => (states[i].capacity(task, "flex") >= Math.min(left, MIN_CHUNK * 2) ? 1 : 0);
    const order = [...beforeDue(task)].sort((a, b) => fits(b) - fits(a) || score(b) - score(a) || a - b);
    placeAcross(task, order, () => "flex");
  }

  // 6. Aufgaben mit Frist, die ins Budget nicht mehr passten: ohne Budget bis zur Frist
  for (const task of sorted) {
    if ((remaining.get(task.id) ?? 0) <= 0 || !task.dueDate) continue;
    placeAcross(task, beforeDue(task), urgentOn(task));
  }

  // Aufgaben, die (teilweise) nicht passen, einmal melden – am Fälligkeitstag oder am letzten Tag
  for (const task of sorted) {
    const left = remaining.get(task.id) ?? 0;
    if (left <= 0) continue;
    const planned = task.durationMin - left;
    const noWorkDay = task.area === "beruflich" && !states.some((s, i) => s.canUseArea(task, urgentOn(task)(i)));
    const budgetOnly = task.area === "privat" && !task.dueDate && task.priority < 3 &&
      states.some((s) => s.capacity(task, "deadline") >= Math.min(left, MIN_CHUNK));
    const reason = noWorkDay
      ? "Kein Arbeitstag im Zeitraum"
      : planned > 0
      ? `${left} Min. passen nicht mehr hinein`
      : budgetOnly
      ? "Genug für diesen Zeitraum geplant – kommt beim nächsten Planen dran"
      : "Kein freier Platz mehr";
    const dueIndex = task.dueDate ? days.findIndex((d) => d.date === task.dueDate) : -1;
    states[dueIndex >= 0 ? dueIndex : days.length - 1].unscheduled.push({ title: task.title, reason, ref: { table: "tasks", id: task.id } });
  }

  // Teile einer Aufgabe zeitlich durchnummerieren
  const byTask = new Map<string, TaskPart[]>();
  for (const part of allParts) byTask.set(part.taskId, [...(byTask.get(part.taskId) ?? []), part]);
  for (const [taskId, parts] of byTask) {
    const unfinished = (remaining.get(taskId) ?? 0) > 0;
    if (parts.length < 2 && !unfinished) continue;
    parts.sort((a, b) => a.block.start.getTime() - b.block.start.getTime());
    const title = tasks.find((t) => t.id === taskId)?.title ?? parts[0].block.title;
    parts.forEach((p, n) => (p.block.title = `${title} (Teil ${n + 1})`));
  }

  return states.map((s) => s.result());
}

function minutesOf(block: PlannedBlock): number {
  return (block.end.getTime() - block.start.getTime()) / 60_000;
}

export interface PlanOptions {
  now?: Date;
}

/** Plans a single day. */
export function planDay(input: DayInput, tasks: PlanTask[], settings: PlannerSettings, options: PlanOptions = {}): DayPlan {
  return planDays([input], tasks, settings, options.now)[0];
}
