import { describe, expect, it } from "vitest";
import { atMinutes, formatTime } from "./dates";
import { type DayInput, findSlot, planDay, planDays, type PlannerSettings, type PlanTask, subtract } from "./planner";

const settings: PlannerSettings = {
  dayStart: "07:00",
  dayEnd: "22:00",
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  lunchStart: "12:30",
  lunchMinutes: 30,
  dinnerTime: "19:00",
  bufferMinutes: 10,
  maxBlockMinutes: 90,
  workoutTime: "abends",
  choreTime: "abends",
};

// 2026-09-29 is a Tuesday, 2026-10-03 a Saturday
const TUESDAY = "2026-09-29";
const SATURDAY = "2026-10-03";

function day(date: string, extra: Partial<DayInput> = {}): DayInput {
  return { date, busy: [], workouts: [], chores: [], meals: [], shopping: null, ...extra };
}

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: `Aufgabe ${id}`,
  area: "privat",
  priority: 2,
  durationMin: 60,
  dueDate: null,
  ...extra,
});

const hhmm = (d: Date) => formatTime(d);

describe("Intervall-Hilfen", () => {
  it("zieht Zeiträume ab", () => {
    expect(subtract([[0, 100]], [20, 30])).toEqual([[0, 20], [30, 100]]);
    expect(subtract([[0, 100]], [-10, 200])).toEqual([]);
  });
  it("findet frühesten und spätesten Platz auf 5-Minuten-Raster", () => {
    expect(findSlot([[61, 200]], 30, [[0, 300]])).toBe(65);
    expect(findSlot([[61, 200]], 30, [[0, 300]], "latest")).toBe(170);
    expect(findSlot([[0, 20]], 30, [[0, 300]])).toBeNull();
  });
});

describe("planDay", () => {
  it("legt berufliche Aufgaben in die Arbeitszeit und private davor oder danach", () => {
    const plan = planDay(day(TUESDAY), [task("job", { area: "beruflich" }), task("privat")], settings);
    const job = plan.blocks.find((b) => b.ref?.id === "job")!;
    const priv = plan.blocks.find((b) => b.ref?.id === "privat")!;
    expect(hhmm(job.start)).toBe("09:00");
    expect(hhmm(priv.start)).toBe("07:00");
    expect(plan.unscheduled).toEqual([]);
  });

  it("respektiert Termine mit Puffer", () => {
    const busy = [{ start: atMinutes(TUESDAY, 9 * 60), end: atMinutes(TUESDAY, 10 * 60) }];
    const plan = planDay(day(TUESDAY, { busy }), [task("job", { area: "beruflich" })], settings);
    expect(hhmm(plan.blocks[0].start)).toBe("10:10");
    expect(plan.busyMinutes).toBe(60);
  });

  it("kocht rechtzeitig vor dem Abendessen", () => {
    const plan = planDay(day(TUESDAY, { meals: [{ id: "m1", title: "Lasagne", prepMin: 60, meal: "abend" }] }), [], settings);
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].title).toBe("Kochen: Lasagne");
    expect(hhmm(plan.blocks[0].start)).toBe("18:00");
    expect(hhmm(plan.blocks[0].end)).toBe("19:00");
  });

  it("plant Sport in der Wunschzeit und nie in der Arbeitszeit", () => {
    const plan = planDay(day(TUESDAY, { workouts: [{ id: "w1", title: "Laufen", durationMin: 45, preferredTime: "morgens" }] }), [], settings);
    expect(hhmm(plan.blocks[0].start)).toBe("07:00");
    const evening = planDay(day(TUESDAY, { workouts: [{ id: "w2", title: "Yoga", durationMin: 45, preferredTime: "egal" }] }), [], settings);
    expect(hhmm(evening.blocks[0].start)).toBe("17:00");
  });

  it("teilt lange Aufgaben in Blöcke", () => {
    const plan = planDay(day(SATURDAY), [task("steuer", { title: "Steuererklärung", durationMin: 180 })], settings);
    const parts = plan.blocks.filter((b) => b.ref?.id === "steuer");
    expect(parts.map((p) => p.title)).toEqual(["Steuererklärung (Teil 1)", "Steuererklärung (Teil 2)"]);
    expect(parts.reduce((s, p) => s + (p.end.getTime() - p.start.getTime()) / 60000, 0)).toBe(180);
  });

  it("meldet, was nicht mehr passt", () => {
    const busy = [{ start: atMinutes(SATURDAY, 7 * 60), end: atMinutes(SATURDAY, 22 * 60) }];
    const plan = planDay(day(SATURDAY, { busy }), [task("x")], settings);
    expect(plan.blocks).toEqual([]);
    expect(plan.unscheduled[0].reason).toBe("Kein freier Platz mehr");
  });

  it("nummeriert Teile in zeitlicher Reihenfolge", () => {
    // 55 Minuten frei am Morgen, der große Block passt erst später
    const busy = [{ start: atMinutes(TUESDAY, 9 * 60 + 5), end: atMinutes(TUESDAY, 16 * 60 + 50) }];
    const plan = planDay(day(TUESDAY, { busy }), [task("lang", { title: "Konzept", area: "privat", priority: 3, durationMin: 120 })], settings);
    const parts = plan.blocks.filter((b) => b.ref?.id === "lang");
    expect(parts.map((p) => p.title)).toEqual(["Konzept (Teil 1)", "Konzept (Teil 2)"]);
    expect(parts[0].start.getTime()).toBeLessThan(parts[1].start.getTime());
  });

  it("lässt Freizeit übrig: nicht dringende private Aufgaben nur im Tagesbudget", () => {
    const tasks = [task("a", { durationMin: 90 }), task("b", { durationMin: 60 }), task("c", { durationMin: 60 })];
    const plan = planDay(day(TUESDAY), tasks, settings);
    const planned = plan.blocks.filter((b) => b.kind === "aufgabe").reduce((s, b) => s + (b.end.getTime() - b.start.getTime()) / 60000, 0);
    expect(planned).toBeLessThanOrEqual(120);
    expect(plan.unscheduled.some((u) => u.reason.startsWith("Genug für diesen Zeitraum"))).toBe(true);
  });

  it("plant heute nicht in der Vergangenheit", () => {
    const now = atMinutes(TUESDAY, 18 * 60 + 2);
    const plan = planDay(day(TUESDAY), [task("abend")], settings, { now });
    expect(plan.blocks[0].start.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("zieht dringende Aufgaben vor", () => {
    const tasks = [
      task("spaeter", { priority: 1, durationMin: 60 }),
      task("dringend", { priority: 2, durationMin: 60, dueDate: TUESDAY }),
    ];
    const plan = planDay(day(TUESDAY), tasks, settings);
    const first = plan.blocks.find((b) => b.kind === "aufgabe")!;
    expect(first.ref?.id).toBe("dringend");
  });

  it("plant den Einkauf nach der Arbeit", () => {
    const plan = planDay(day(TUESDAY, { shopping: { items: 7, durationMin: 45 } }), [], settings);
    expect(plan.blocks[0].title).toBe("Einkaufen (7 Artikel)");
    expect(hhmm(plan.blocks[0].start)).toBe("17:00");
  });
});

describe("planDays", () => {
  it("holt Haushalt und Einkauf am nächsten Tag nach", () => {
    const full = [{ start: atMinutes(TUESDAY, 7 * 60), end: atMinutes(TUESDAY, 22 * 60) }];
    const chore = { id: "c1", title: "Staubsaugen", durationMin: 30, preferredTime: "abends" as const };
    const plans = planDays(
      [
        day(TUESDAY, { busy: full, chores: [chore], shopping: { items: 8, durationMin: 45 } }),
        day("2026-09-30", { chores: [chore], shopping: { items: 8, durationMin: 45 } }),
      ],
      [],
      settings,
    );
    expect(plans[0].blocks).toEqual([]);
    expect(plans[0].unscheduled).toEqual([]);
    expect(plans[1].blocks.map((b) => b.kind).sort()).toEqual(["einkauf", "haushalt"]);
  });

  it("verteilt Aufgaben auf den Tag mit mehr Luft", () => {
    const busyTuesday = [{ start: atMinutes(TUESDAY, 17 * 60), end: atMinutes(TUESDAY, 21 * 60) }];
    const plans = planDays([day(TUESDAY, { busy: busyTuesday }), day("2026-09-30")], [task("x", { durationMin: 60 })], settings);
    expect(plans[0].blocks).toEqual([]);
    expect(plans[1].blocks[0].ref?.id).toBe("x");
  });

  it("hält Fristen ein, auch wenn das Tagesbudget voll ist", () => {
    const tasks = [
      task("gross", { durationMin: 120, priority: 2 }),
      task("frist", { durationMin: 60, priority: 1, dueDate: TUESDAY }),
    ];
    const plans = planDays([day(TUESDAY)], tasks, settings);
    expect(plans[0].blocks.some((b) => b.ref?.id === "frist")).toBe(true);
  });

  it("verteilt Aufgaben auf mehrere Tage und meldet sie nur einmal", () => {
    const busyDay = [{ start: atMinutes(SATURDAY, 7 * 60), end: atMinutes(SATURDAY, 22 * 60) }];
    const plans = planDays(
      [day(SATURDAY, { busy: busyDay }), day("2026-10-04")],
      [task("a", { durationMin: 60 })],
      settings,
    );
    expect(plans[0].blocks).toEqual([]);
    expect(plans[0].unscheduled).toEqual([]);
    expect(plans[1].blocks[0].ref?.id).toBe("a");
  });
});
