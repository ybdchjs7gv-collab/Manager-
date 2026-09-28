import { Dumbbell, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toggleWorkoutDone } from "../../lib/actions";
import { callAi, useAiStatus } from "../../lib/ai";
import { addDaysStr, formatDayShort, startOfWeekStr, todayStr, WEEKDAY_LABELS } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import { activeWorkouts, workoutLogs } from "../../lib/queries";
import type { TimePref, Workout } from "../../lib/types";
import { Button, Card, Check, Empty, Field, Notice, Sheet, Toggle, useAction, WeekdayPicker } from "../ui";

const SPORTS: Record<string, string> = {
  laufen: "Laufen",
  kraft: "Kraft",
  yoga: "Yoga",
  rad: "Radfahren",
  schwimmen: "Schwimmen",
  gehen: "Spazieren",
  mobility: "Mobility",
  hiit: "HIIT",
  sonstiges: "Sonstiges",
};

const TIMES: Record<TimePref, string> = { morgens: "morgens", mittags: "mittags", abends: "abends", egal: "egal wann" };

export function SportView() {
  const today = todayStr();
  const weekStart = startOfWeekStr(today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  const data = useLive(["workouts", "workout_logs"], async () => ({ workouts: await activeWorkouts(), logs: await workoutLogs(days[0], days[6]) }), [weekStart]);
  const ai = useAiStatus();
  const [editing, setEditing] = useState<Workout | "new" | null>(null);
  const [planning, setPlanning] = useState(false);

  const workouts = data.data?.workouts ?? [];
  const logs = data.data?.logs ?? [];
  const planned = days.flatMap((d, i) => workouts.filter((w) => w.weekdays.includes(i + 1)).map((w) => ({ day: d, w })));
  const doneCount = planned.filter((p) => logs.some((l) => l.workout_id === p.w.id && l.day === p.day)).length;
  const minutes = logs.reduce((s, l) => s + (l.duration_min ?? 0), 0);

  return (
    <div className="stack">
      <div className="row between wrap" style={{ gap: 10 }}>
        <span className="muted">Diese Woche: <b style={{ color: "var(--text)" }}>{doneCount} von {planned.length}</b> Einheiten · {minutes} Min.</span>
        <div className="row">
          {ai.data?.configured && <Button size="sm" icon={<Sparkles size={16} />} onClick={() => setPlanning(true)}>Plan mit KI</Button>}
          <Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>Einheit</Button>
        </div>
      </div>
      {planned.length > 0 && (
        <div className="progress"><div style={{ width: `${(doneCount / planned.length) * 100}%` }} /></div>
      )}

      {workouts.length === 0 ? (
        <Empty icon={<Dumbbell size={24} />} title="Noch kein Sportplan" text="Lege feste Einheiten an – der Planer findet dafür automatisch freie Zeiten." />
      ) : (
        <>
          <Card title="Diese Woche" padded={false}>
            <div className="list">
              {days.map((d, i) => {
                const todays = workouts.filter((w) => w.weekdays.includes(i + 1));
                return (
                  <div key={d} className="list-row" style={d === today ? { background: "var(--surface-2)" } : undefined}>
                    <span className="strong" style={{ width: 34 }}>{WEEKDAY_LABELS[i]}</span>
                    <div className="grow stack tight">
                      {todays.length === 0 && <span className="small faint">Ruhetag</span>}
                      {todays.map((w) => {
                        const done = logs.some((l) => l.workout_id === w.id && l.day === d);
                        return (
                          <div key={w.id} className="row">
                            <Check done={done} onToggle={() => void toggleWorkoutDone(w.id, w.title, w.duration_min, d, !done)} label={`${w.title} am ${formatDayShort(d)} erledigt`} />
                            <span className={`grow truncate ${done ? "done-text" : ""}`}>{w.title}</span>
                            <span className="small muted">{w.duration_min} Min.</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Mein Plan">
            <div className="list">
              {workouts.map((w) => (
                <button key={w.id} className="list-row" onClick={() => setEditing(w)}>
                  <Dumbbell size={18} style={{ color: "var(--k-sport)" }} />
                  <div className="grow stack tight" style={{ gap: 2 }}>
                    <span className="strong truncate">{w.title}</span>
                    <span className="small muted">
                      {w.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ") || "flexibel"} · {w.duration_min} Min. · {TIMES[w.preferred_time]}
                      {w.intensity ? ` · ${w.intensity}` : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
      {editing && <WorkoutSheet workout={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {planning && <AiWorkoutSheet onClose={() => setPlanning(false)} />}
    </div>
  );
}

function WorkoutSheet({ workout, onClose }: { workout?: Workout; onClose: () => void }) {
  const [title, setTitle] = useState(workout?.title ?? "");
  const [sport, setSport] = useState(workout?.sport ?? "laufen");
  const [duration, setDuration] = useState(String(workout?.duration_min ?? 45));
  const [weekdays, setWeekdays] = useState<number[]>(workout?.weekdays ?? []);
  const [time, setTime] = useState<TimePref>(workout?.preferred_time ?? "egal");
  const [intensity, setIntensity] = useState(workout?.intensity ?? "");
  const [notes, setNotes] = useState(workout?.notes ?? "");
  const { busy, run } = useAction();

  const save = () =>
    run("save", async () => {
      const fields = { title: title.trim() || SPORTS[sport], sport, duration_min: Math.max(5, Number(duration) || 45), weekdays, preferred_time: time, intensity: intensity.trim() || null, notes: notes.trim() || null };
      if (workout) await db().update("workouts", [["id", "eq", workout.id]], fields);
      else await db().insert("workouts", [fields]);
      invalidate("workouts");
      onClose();
    }, "Gespeichert");

  const remove = () =>
    run("delete", async () => {
      if (!workout || !confirm(`„${workout.title}“ aus dem Plan nehmen?`)) return;
      await db().update("workouts", [["id", "eq", workout.id]], { active: false });
      invalidate("workouts");
      onClose();
    });

  return (
    <Sheet
      title={workout ? "Einheit bearbeiten" : "Neue Einheit"}
      onClose={onClose}
      footer={
        <>
          {workout && <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Entfernen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Sportart">
            <select className="select" value={sport} onChange={(e) => setSport(e.target.value)}>
              {Object.entries(SPORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Dauer (Min.)"><input className="input" type="number" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
          <Field label="Titel" className="span-2"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={SPORTS[sport]} /></Field>
        </div>
        <Field label="An welchen Tagen?"><WeekdayPicker value={weekdays} onChange={setWeekdays} /></Field>
        <Field label="Bevorzugte Tageszeit">
          <select className="select" value={time} onChange={(e) => setTime(e.target.value as TimePref)}>
            {(Object.keys(TIMES) as TimePref[]).map((t) => <option key={t} value={t}>{TIMES[t]}</option>)}
          </select>
        </Field>
        <Field label="Intensität"><input className="input" value={intensity} onChange={(e) => setIntensity(e.target.value)} placeholder="z. B. locker, mittel, intensiv" /></Field>
        <Field label="Hinweise"><textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

interface PlannedWorkout {
  title: string;
  sport: string;
  duration_min: number;
  weekdays: number[];
  preferred_time: TimePref;
  intensity: string;
  notes: string;
}

function AiWorkoutSheet({ onClose }: { onClose: () => void }) {
  const [goal, setGoal] = useState("fitter werden und mehr Energie");
  const [level, setLevel] = useState("mittel");
  const [perWeek, setPerWeek] = useState("3");
  const [minutes, setMinutes] = useState("40");
  const [time, setTime] = useState<TimePref>("abends");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 6]);
  const [notes, setNotes] = useState("");
  const [replace, setReplace] = useState(true);
  const [result, setResult] = useState<{ workouts: PlannedWorkout[]; advice: string } | null>(null);
  const { busy, run } = useAction();

  const plan = () =>
    run("plan", async () => {
      setResult(await callAi("plan_workouts", {
        goal, level, per_week: Number(perWeek), minutes: Number(minutes), preferred_time: time,
        weekdays: weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ") || "flexibel", notes,
      }));
    });

  const accept = () =>
    run("save", async () => {
      if (!result) return;
      if (replace) await db().update("workouts", [["active", "eq", true]], { active: false });
      await db().insert("workouts", result.workouts.map((w) => ({ ...w, intensity: w.intensity || null, notes: w.notes || null })));
      invalidate("workouts");
      onClose();
    }, "Sportplan übernommen");

  return (
    <Sheet
      title="Sportplan mit KI"
      onClose={onClose}
      footer={result ? (
        <>
          <Button onClick={() => setResult(null)}>Zurück</Button>
          <Button variant="primary" loading={busy === "save"} onClick={accept}>Übernehmen</Button>
        </>
      ) : (
        <Button variant="primary" icon={<Sparkles size={16} />} loading={busy === "plan"} onClick={plan}>Plan erstellen</Button>
      )}
    >
      {!result ? (
        <div className="stack">
          <Field label="Dein Ziel"><input className="input" value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
          <div className="form-grid">
            <Field label="Fitness">
              <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="Einsteiger">Einsteiger</option>
                <option value="mittel">Mittel</option>
                <option value="fortgeschritten">Fortgeschritten</option>
              </select>
            </Field>
            <Field label="Einheiten/Woche"><input className="input" type="number" inputMode="numeric" min={1} max={7} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} /></Field>
            <Field label="Minuten pro Einheit"><input className="input" type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
            <Field label="Tageszeit">
              <select className="select" value={time} onChange={(e) => setTime(e.target.value as TimePref)}>
                {(Object.keys(TIMES) as TimePref[]).map((t) => <option key={t} value={t}>{TIMES[t]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Mögliche Tage"><WeekdayPicker value={weekdays} onChange={setWeekdays} /></Field>
          <Field label="Sonstiges"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="z. B. Knieprobleme, am liebsten draußen" /></Field>
        </div>
      ) : (
        <div className="stack">
          {result.advice && <Notice>{result.advice}</Notice>}
          {result.workouts.map((w) => (
            <div key={w.title + w.weekdays.join()} className="card flat stack tight">
              <span className="strong">{w.title}</span>
              <span className="small muted">{w.weekdays.map((d) => WEEKDAY_LABELS[d - 1]).join(", ")} · {w.duration_min} Min. · {TIMES[w.preferred_time]} · {w.intensity}</span>
              <span className="small">{w.notes}</span>
            </div>
          ))}
          <Toggle checked={replace} onChange={setReplace} label="Bisherigen Plan ersetzen" />
        </div>
      )}
    </Sheet>
  );
}
