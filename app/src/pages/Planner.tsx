import { AlertCircle, CalendarCheck, Lightbulb, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DayTimeline, eventToItem, type TimelineItem } from "../components/DayTimeline";
import { PageHeader } from "../components/Layout";
import { Button, Card, Loading, Notice, Segmented, Toggle, useAction } from "../components/ui";
import { createEvents, deleteEvents } from "../lib/actions";
import { callAi, useAiStatus } from "../lib/ai";
import { plannerSettings, useApp } from "../lib/app-state";
import { addDaysStr, durationLabel, formatDayLong, formatTime, isoWeekday, toDateStr, todayStr } from "../lib/dates";
import { db } from "../lib/db";
import { invalidate, useLive } from "../lib/hooks";
import { type DayInput, type DayPlan, planDays, type PlanTask } from "../lib/planner";
import { activeChores, activeWorkouts, eventsBetween, mealsBetween, openTasks, workoutLogs } from "../lib/queries";
import { navigate, queryParam } from "../lib/router";
import type { CalEvent, EventKind, Task } from "../lib/types";

type Range = "heute" | "morgen" | "woche";

interface PlannerData {
  days: string[];
  inputs: DayInput[];
  tasks: PlanTask[];
  fixed: CalEvent[];
  replaced: CalEvent[];
  plannedTasks: Task[];
}

async function loadPlannerData(days: string[], opts: { tasks: boolean; sport: boolean; chores: boolean; meals: boolean; shopping: boolean }, shoppingMin: number, shoppingMinutes: number): Promise<PlannerData> {
  const from = days[0];
  const to = days[days.length - 1];
  const [events, tasks, workouts, logs, chores, meals, shoppingCount] = await Promise.all([
    eventsBetween(from, addDaysStr(to, 1)),
    openTasks(),
    activeWorkouts(),
    workoutLogs(from, to),
    activeChores(),
    mealsBetween(from, to),
    db().count("shopping_items", [["checked", "eq", false]]),
  ]);
  const replaced = events.filter((e) => e.source === "planner" && e.status !== "done");
  const fixed = events.filter((e) => !replaced.includes(e));
  const replacedTaskIds = new Set(replaced.filter((e) => e.ref_table === "tasks").map((e) => e.ref_id));
  const planTasks = tasks.filter((t) => t.status === "offen" || replacedTaskIds.has(t.id));
  const inputs: DayInput[] = days.map((day) => {
    const weekday = isoWeekday(day);
    const dayChores = opts.chores ? chores.filter((c) => c.next_due <= day) : [];
    return {
      date: day,
      busy: fixed
        .filter((e) => toDateStr(new Date(e.start_at)) <= day && toDateStr(new Date(e.end_at)) >= day)
        .map((e) => ({ start: new Date(e.start_at), end: new Date(e.end_at), allDay: e.all_day })),
      workouts: opts.sport
        ? workouts
          .filter((w) => w.weekdays.includes(weekday) && !logs.some((l) => l.workout_id === w.id && l.day === day))
          .map((w) => ({ id: w.id, title: w.title, durationMin: w.duration_min, preferredTime: w.preferred_time }))
        : [],
      chores: dayChores.map((c) => ({ id: c.id, title: c.title, durationMin: c.duration_min, preferredTime: c.preferred_time })),
      meals: opts.meals
        ? meals.filter((m) => m.day === day && (m.prep_min ?? 0) > 0).map((m) => ({ id: m.id, title: m.title, prepMin: m.prep_min ?? 30, meal: m.meal }))
        : [],
      shopping: opts.shopping && shoppingCount >= shoppingMin ? { items: shoppingCount, durationMin: shoppingMinutes } : null,
    };
  });

  return {
    days,
    inputs,
    tasks: opts.tasks
      ? planTasks.map((t) => ({ id: t.id, title: t.title, area: t.area, priority: t.priority, durationMin: t.duration_min, dueDate: t.due_date }))
      : [],
    fixed,
    replaced,
    plannedTasks: tasks.filter((t) => t.status === "geplant" && replacedTaskIds.has(t.id)),
  };
}

export function PlannerPage() {
  const { settings } = useApp();
  const ai = useAiStatus();
  const initialDay = queryParam("tag");
  const [range, setRange] = useState<Range>(() => {
    if (initialDay && initialDay !== todayStr()) return "morgen";
    // Late in the evening there is nothing left to plan for today.
    const now = new Date();
    const [h, m] = settings.day_end.split(":").map(Number);
    return now.getHours() * 60 + now.getMinutes() > h * 60 + m - 90 ? "morgen" : "heute";
  });
  const [opts, setOpts] = useState({ tasks: true, sport: true, chores: true, meals: true, shopping: true });
  const [tips, setTips] = useState<{ briefing: string; tips: string[]; warnings: string[] } | null>(null);
  const { busy, run } = useAction();

  const days = useMemo(() => {
    const today = todayStr();
    if (range === "woche") return Array.from({ length: 7 }, (_, i) => addDaysStr(today, i));
    if (range === "morgen") return [initialDay && initialDay > today ? initialDay : addDaysStr(today, 1)];
    return [today];
  }, [range, initialDay]);

  const prefs = settings.preferences;
  const data = useLive(
    ["events", "tasks", "workouts", "workout_logs", "chores", "meal_plan", "shopping_items"],
    () => loadPlannerData(days, opts, prefs.shopping_min_items ?? 5, prefs.shopping_minutes ?? 45),
    [days.join(), JSON.stringify(opts)],
  );

  const plans: DayPlan[] = useMemo(
    () => (data.data ? planDays(data.data.inputs, data.data.tasks, plannerSettings(settings), new Date()) : []),
    [data.data, settings],
  );

  const totalBlocks = plans.reduce((s, p) => s + p.blocks.length, 0);

  const accept = () =>
    run("accept", async () => {
      if (!data.data) return;
      await deleteEvents(data.data.replaced);
      const drafts = plans.flatMap((p) =>
        p.blocks.map((b) => ({
          title: b.title,
          start_at: b.start.toISOString(),
          end_at: b.end.toISOString(),
          kind: b.kind as EventKind,
          area: b.area,
          source: "planner" as const,
          ref_table: b.ref?.table ?? null,
          ref_id: b.ref?.id ?? null,
          reminder_minutes: 10,
        }))
      );
      const created = await createEvents(drafts);
      const firstEventByTask = new Map<string, string>();
      for (const e of created) if (e.ref_table === "tasks" && e.ref_id && !firstEventByTask.has(e.ref_id)) firstEventByTask.set(e.ref_id, e.id);
      const unscheduledTasks = new Set(plans.flatMap((p) => p.unscheduled).filter((u) => u.ref?.table === "tasks").map((u) => u.ref!.id));
      for (const [taskId, eventId] of firstEventByTask) {
        await db().update("tasks", [["id", "eq", taskId]], { status: unscheduledTasks.has(taskId) ? "offen" : "geplant", event_id: eventId });
      }
      for (const t of data.data.plannedTasks) {
        if (!firstEventByTask.has(t.id)) await db().update("tasks", [["id", "eq", t.id]], { status: "offen", event_id: null });
      }
      invalidate("tasks", "events");
      navigate(range === "woche" ? "kalender" : "");
    }, "Plan übernommen – steht jetzt in deinem Kalender");

  const askAi = () =>
    run("tips", async () => {
      const context = plans.map((p) => [
        `${formatDayLong(p.date)}:`,
        ...(data.data?.fixed ?? [])
          .filter((e) => toDateStr(new Date(e.start_at)) === p.date && !e.all_day)
          .map((e) => `- fest ${formatTime(e.start_at)}–${formatTime(e.end_at)} ${e.title}`),
        ...p.blocks.map((b) => `- geplant ${formatTime(b.start)}–${formatTime(b.end)} ${b.title} (${b.kind})`),
        ...p.unscheduled.map((u) => `- passt nicht: ${u.title} (${u.reason})`),
        `freie Zeit danach: ${durationLabel(p.freeMinutes)}`,
      ].join("\n")).join("\n\n");
      setTips(await callAi("day_briefing", { context }));
    });

  return (
    <div>
      <PageHeader
        title="Planen"
        subtitle="Verteilt Aufgaben, Sport, Kochen, Haushalt und Einkauf auf deine freien Zeiten."
        area={false}
      />
      <div className="stack">
        <Segmented<Range>
          value={range}
          onChange={(r) => { setRange(r); setTips(null); }}
          options={[{ value: "heute", label: "Heute" }, { value: "morgen", label: initialDay && initialDay > addDaysStr(todayStr(), 1) ? formatDayLong(initialDay) : "Morgen" }, { value: "woche", label: "7 Tage" }]}
        />
        <Card title="Was soll eingeplant werden?">
          <Toggle checked={opts.tasks} onChange={(v) => setOpts({ ...opts, tasks: v })} label="Aufgaben" hint="Dringende und wichtige zuerst, berufliche in der Arbeitszeit" />
          <Toggle checked={opts.sport} onChange={(v) => setOpts({ ...opts, sport: v })} label="Sport" hint="Einheiten aus deinem Sportplan" />
          <Toggle checked={opts.meals} onChange={(v) => setOpts({ ...opts, meals: v })} label="Kochen" hint="Rechtzeitig vor dem Essen laut Essensplan" />
          <Toggle checked={opts.chores} onChange={(v) => setOpts({ ...opts, chores: v })} label="Haushalt" hint="Alles, was fällig ist" />
          <Toggle checked={opts.shopping} onChange={(v) => setOpts({ ...opts, shopping: v })} label="Einkaufen" hint={`Ab ${prefs.shopping_min_items ?? 5} Artikeln auf der Liste`} />
        </Card>

        {data.loading && !data.data ? <Loading rows={4} /> : plans.map((plan) => (
          <PlanPreview key={plan.date} plan={plan} fixed={(data.data?.fixed ?? []).filter((e) => toDateStr(new Date(e.start_at)) <= plan.date && toDateStr(new Date(e.end_at)) >= plan.date)} showDate={plans.length > 1} />
        ))}

        {tips && (
          <Card title="Tipps der KI" icon={<Lightbulb size={18} />}>
            <div className="stack tight">
              <span>{tips.briefing}</span>
              {tips.warnings.map((w) => <span key={w} className="small" style={{ color: "var(--warning)" }}>⚠︎ {w}</span>)}
              {tips.tips.map((t) => <span key={t} className="small muted">• {t}</span>)}
            </div>
          </Card>
        )}

        {(data.data?.replaced.length ?? 0) > 0 && (
          <Notice>Bereits geplante Blöcke in diesem Zeitraum ({data.data!.replaced.length}) werden durch den neuen Plan ersetzt.</Notice>
        )}

        <div className="row wrap" style={{ justifyContent: "flex-end" }}>
          {ai.data?.configured && totalBlocks > 0 && (
            <Button icon={<Lightbulb size={17} />} loading={busy === "tips"} onClick={askAi}>KI-Tipps</Button>
          )}
          <Button variant="primary" icon={<CalendarCheck size={17} />} loading={busy === "accept"} disabled={totalBlocks === 0 && (data.data?.replaced.length ?? 0) === 0} onClick={accept}>
            Plan übernehmen
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanPreview({ plan, fixed, showDate }: { plan: DayPlan; fixed: CalEvent[]; showDate: boolean }) {
  const items: TimelineItem[] = [
    ...fixed.map(eventToItem),
    ...plan.blocks.map((b, i) => ({
      key: `p-${i}`,
      title: b.title,
      start: b.start,
      end: b.end,
      kind: b.kind,
      area: b.area,
      proposed: true,
      note: "neu",
    })),
  ];
  return (
    <Card
      title={showDate ? formatDayLong(plan.date) : "Vorschlag"}
      icon={<Wand2 size={18} />}
      action={<span className="small muted">{plan.blocks.length} Blöcke · frei {durationLabel(plan.freeMinutes)}</span>}
    >
      <DayTimeline items={items} emptyText="Nichts zu planen – genieß die freie Zeit." />
      {plan.unscheduled.length > 0 && (
        <div className="stack tight" style={{ marginTop: 12 }}>
          {plan.unscheduled.map((u, i) => (
            <div key={i} className="row small" style={{ color: "var(--warning)" }}>
              <AlertCircle size={15} /> <span className="strong">{u.title}</span> <span className="muted">– {u.reason}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
