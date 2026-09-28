import { Trash2 } from "lucide-react";
import { useState } from "react";
import { addTask, deleteTask, updateTask } from "../lib/actions";
import { useApp } from "../lib/app-state";
import type { Area, Task } from "../lib/types";
import { Button, Field, Segmented, Sheet, useAction } from "./ui";

export function TaskEditor({ task, preset, onClose }: { task?: Task; preset?: Partial<Task>; onClose: () => void }) {
  const { area: areaFilter } = useApp();
  const [title, setTitle] = useState(task?.title ?? preset?.title ?? "");
  const [area, setArea] = useState<Area>(task?.area ?? preset?.area ?? (areaFilter === "beruflich" ? "beruflich" : "privat"));
  const [priority, setPriority] = useState<string>(String(task?.priority ?? preset?.priority ?? 2));
  const [duration, setDuration] = useState<string>(String(task?.duration_min ?? preset?.duration_min ?? 30));
  const [due, setDue] = useState(task?.due_date ?? preset?.due_date ?? "");
  const [notes, setNotes] = useState(task?.notes ?? preset?.notes ?? "");
  const { busy, run } = useAction();

  const save = () =>
    run("save", async () => {
      if (!title.trim()) throw new Error("Bitte einen Titel eingeben.");
      const fields = {
        title: title.trim(),
        area,
        priority: Number(priority) as 1 | 2 | 3,
        duration_min: Math.max(5, Number(duration) || 30),
        due_date: due || null,
        notes: notes.trim() || null,
      };
      if (task) await updateTask(task.id, fields);
      else await addTask({ ...preset, ...fields });
      onClose();
    }, task ? "Aufgabe gespeichert" : "Aufgabe angelegt");

  const remove = () =>
    run("delete", async () => {
      if (!task || !confirm(`„${task.title}“ löschen?`)) return;
      await deleteTask(task);
      onClose();
    }, "Aufgabe gelöscht");

  return (
    <Sheet
      title={task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
      onClose={onClose}
      footer={
        <>
          {task && <Button variant="danger" icon={<Trash2 size={17} />} loading={busy === "delete"} onClick={remove}>Löschen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Was ist zu tun?">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} placeholder="z. B. Steuerunterlagen sortieren" />
        </Field>
        <Segmented<Area>
          full
          value={area}
          onChange={setArea}
          options={[{ value: "privat", label: "Privat" }, { value: "beruflich", label: "Beruflich" }]}
        />
        <div className="form-grid">
          <Field label="Wichtigkeit">
            <select className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="3">Hoch</option>
              <option value="2">Mittel</option>
              <option value="1">Niedrig</option>
            </select>
          </Field>
          <Field label="Dauer">
            <select className="select" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[10, 15, 20, 30, 45, 60, 90, 120, 180, 240].map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} Min.` : `${m / 60} Std.`}</option>
              ))}
              {![10, 15, 20, 30, 45, 60, 90, 120, 180, 240].includes(Number(duration)) && <option value={duration}>{duration} Min.</option>}
            </select>
          </Field>
          <Field label="Fällig bis" className="span-2" hint="Optional – der Planer zieht fällige Aufgaben vor.">
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Notizen">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
      </div>
    </Sheet>
  );
}
