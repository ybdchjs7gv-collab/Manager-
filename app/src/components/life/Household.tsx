import { Home, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { markChoreDone } from "../../lib/actions";
import { addDaysStr, diffDays, formatDayShort, relativeDay, todayStr } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import { activeChores } from "../../lib/queries";
import type { Chore, TimePref } from "../../lib/types";
import { Badge, Button, Card, Check, Empty, Field, Sheet, useAction } from "../ui";

const TEMPLATES: { title: string; room: string; interval_days: number; duration_min: number }[] = [
  { title: "Staubsaugen", room: "Wohnung", interval_days: 7, duration_min: 30 },
  { title: "Bad putzen", room: "Bad", interval_days: 7, duration_min: 40 },
  { title: "Küche wischen", room: "Küche", interval_days: 7, duration_min: 20 },
  { title: "Wäsche waschen", room: "Wäsche", interval_days: 4, duration_min: 20 },
  { title: "Bettwäsche wechseln", room: "Schlafzimmer", interval_days: 14, duration_min: 20 },
  { title: "Müll rausbringen", room: "Küche", interval_days: 3, duration_min: 10 },
  { title: "Staub wischen", room: "Wohnung", interval_days: 14, duration_min: 20 },
  { title: "Pflanzen gießen", room: "Wohnung", interval_days: 3, duration_min: 10 },
  { title: "Kühlschrank reinigen", room: "Küche", interval_days: 30, duration_min: 30 },
  { title: "Fenster putzen", room: "Wohnung", interval_days: 60, duration_min: 60 },
];

function dueBadge(chore: Chore, today: string) {
  const diff = diffDays(chore.next_due, today);
  if (diff < 0) return <Badge tone="danger">seit {Math.abs(diff)} {Math.abs(diff) === 1 ? "Tag" : "Tagen"}</Badge>;
  if (diff === 0) return <Badge tone="warning">heute</Badge>;
  if (diff === 1) return <Badge>morgen</Badge>;
  return <span className="small muted">in {diff} Tagen</span>;
}

export function HouseholdView() {
  const chores = useLive(["chores"], activeChores);
  const [editing, setEditing] = useState<Chore | "new" | null>(null);
  const { busy, run } = useAction();
  const today = todayStr();
  const list = chores.data ?? [];
  const due = list.filter((c) => c.next_due <= today);
  const later = list.filter((c) => c.next_due > today);

  const addTemplates = () =>
    run("tpl", async () => {
      await db().insert("chores", TEMPLATES.map((t, i) => ({ ...t, next_due: addDaysStr(today, i % 4), preferred_time: "abends" as TimePref })));
      invalidate("chores");
    }, "Haushaltsplan angelegt");

  return (
    <div className="stack">
      <div className="row between">
        <span className="muted">{due.length === 0 ? "Heute ist nichts fällig 🎉" : `${due.length} fällig`}</span>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => setEditing("new")}>Aufgabe</Button>
      </div>
      {list.length === 0 ? (
        <Empty
          icon={<Home size={24} />}
          title="Noch kein Haushaltsplan"
          text="Wiederkehrende Aufgaben werden automatisch fällig und vom Planer eingeplant."
          action={<Button variant="primary" loading={busy === "tpl"} onClick={addTemplates}>Typische Aufgaben anlegen</Button>}
        />
      ) : (
        <>
          {due.length > 0 && <ChoreCard title="Fällig" chores={due} today={today} onEdit={setEditing} />}
          {later.length > 0 && <ChoreCard title="Demnächst" chores={later} today={today} onEdit={setEditing} />}
        </>
      )}
      {editing && <ChoreSheet chore={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChoreCard({ title, chores, today, onEdit }: { title: string; chores: Chore[]; today: string; onEdit: (c: Chore) => void }) {
  return (
    <Card title={title}>
      <div className="list">
        {chores.map((c) => (
          <div key={c.id} className="list-row clickable" onClick={() => onEdit(c)}>
            <Check done={false} onToggle={() => void markChoreDone(c)} label={`${c.title} erledigt`} />
            <div className="grow stack tight" style={{ gap: 2 }}>
              <span className="truncate">{c.title}</span>
              <span className="small muted">
                {c.room ? `${c.room} · ` : ""}alle {c.interval_days} Tage · {c.duration_min} Min.
                {c.last_done_at ? ` · zuletzt ${relativeDay(c.last_done_at.slice(0, 10))}` : ""}
              </span>
            </div>
            {dueBadge(c, today)}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ChoreSheet({ chore, onClose }: { chore?: Chore; onClose: () => void }) {
  const [title, setTitle] = useState(chore?.title ?? "");
  const [room, setRoom] = useState(chore?.room ?? "");
  const [interval, setIntervalDays] = useState(String(chore?.interval_days ?? 7));
  const [duration, setDuration] = useState(String(chore?.duration_min ?? 20));
  const [time, setTime] = useState<TimePref>(chore?.preferred_time ?? "egal");
  const [nextDue, setNextDue] = useState(chore?.next_due ?? todayStr());
  const { busy, run } = useAction();

  const save = () =>
    run("save", async () => {
      if (!title.trim()) throw new Error("Bitte einen Titel eingeben.");
      const fields = { title: title.trim(), room: room.trim() || null, interval_days: Math.max(1, Number(interval) || 7), duration_min: Math.max(5, Number(duration) || 20), preferred_time: time, next_due: nextDue };
      if (chore) await db().update("chores", [["id", "eq", chore.id]], fields);
      else await db().insert("chores", [fields]);
      invalidate("chores");
      onClose();
    }, "Gespeichert");

  const remove = () =>
    run("delete", async () => {
      if (!chore || !confirm(`„${chore.title}“ löschen?`)) return;
      await db().remove("chores", [["id", "eq", chore.id]]);
      invalidate("chores");
      onClose();
    });

  return (
    <Sheet
      title={chore ? "Haushaltsaufgabe" : "Neue Haushaltsaufgabe"}
      onClose={onClose}
      footer={
        <>
          {chore && <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Löschen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Was?"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Bad putzen" /></Field>
        <div className="form-grid">
          <Field label="Raum"><input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="optional" /></Field>
          <Field label="Alle … Tage"><input className="input" type="number" inputMode="numeric" min={1} value={interval} onChange={(e) => setIntervalDays(e.target.value)} /></Field>
          <Field label="Dauer (Min.)"><input className="input" type="number" inputMode="numeric" min={5} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
          <Field label="Tageszeit">
            <select className="select" value={time} onChange={(e) => setTime(e.target.value as TimePref)}>
              <option value="egal">egal</option>
              <option value="morgens">morgens</option>
              <option value="mittags">mittags</option>
              <option value="abends">abends</option>
            </select>
          </Field>
          <Field label="Nächstes Mal fällig" className="span-2" hint={nextDue ? formatDayShort(nextDue) : undefined}>
            <input className="input" type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}
