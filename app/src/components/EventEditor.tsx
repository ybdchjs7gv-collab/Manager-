import { Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { createEvents, deleteEvent, updateEvent } from "../lib/actions";
import { useApp } from "../lib/app-state";
import { addDaysStr, combine, formatTime, toDateStr, todayStr } from "../lib/dates";
import type { Area, CalEvent, EventKind } from "../lib/types";
import { KIND_LABELS } from "./KindIcon";
import { Button, Field, Notice, Segmented, Sheet, Toggle, useAction } from "./ui";

export interface EventPreset {
  title?: string;
  date?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  area?: Area;
  kind?: EventKind;
  location?: string;
  description?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function roundedNow(): string {
  const d = new Date();
  const minutes = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 30) * 30 + 30;
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function EventEditor({ event, preset, onClose }: { event?: CalEvent; preset?: EventPreset; onClose: () => void }) {
  const { area: areaFilter } = useApp();
  const readOnly = event?.source === "caldav";
  const start = event ? new Date(event.start_at) : null;
  const end = event ? new Date(event.end_at) : null;
  const initialStart = preset?.start ?? (start ? formatTime(start) : roundedNow());

  const [title, setTitle] = useState(event?.title ?? preset?.title ?? "");
  const [date, setDate] = useState(event ? toDateStr(start!) : preset?.date ?? todayStr());
  const [allDay, setAllDay] = useState(event?.all_day ?? preset?.allDay ?? false);
  const [from, setFrom] = useState(initialStart);
  const [to, setTo] = useState(preset?.end ?? (end ? formatTime(end) : addMinutes(initialStart, 60)));
  const [endDate, setEndDate] = useState(event?.all_day && end ? addDaysStr(toDateStr(end), -1) : date);
  const [area, setArea] = useState<Area>(event?.area ?? preset?.area ?? (areaFilter === "beruflich" ? "beruflich" : "privat"));
  const [kind, setKind] = useState<EventKind>(event?.kind ?? preset?.kind ?? "termin");
  const [location, setLocation] = useState(event?.location ?? preset?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? preset?.description ?? "");
  const [reminder, setReminder] = useState<string>(String(event?.reminder_minutes ?? 15));
  const { busy, run } = useAction();

  const save = () =>
    run("save", async () => {
      if (!title.trim()) throw new Error("Bitte einen Titel eingeben.");
      const startAt = allDay ? combine(date, "00:00") : combine(date, from);
      let endAt = allDay ? combine(addDaysStr(endDate < date ? date : endDate, 1), "00:00") : combine(date, to);
      if (!allDay && endAt <= startAt) endAt = new Date(startAt.getTime() + 60 * 60_000);
      const fields = {
        title: title.trim(),
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        all_day: allDay,
        area,
        kind,
        location: location.trim() || null,
        description: description.trim() || null,
        reminder_minutes: reminder === "none" || allDay ? null : Number(reminder),
      };
      if (event) await updateEvent(event, fields);
      else await createEvents([{ ...fields, source: "manual" }]);
      onClose();
    }, event ? "Termin gespeichert" : "Termin angelegt");

  const remove = () =>
    run("delete", async () => {
      if (!event || !confirm(`„${event.title}“ löschen?`)) return;
      await deleteEvent(event);
      onClose();
    }, "Termin gelöscht");

  return (
    <Sheet
      title={event ? (readOnly ? "Termin" : "Termin bearbeiten") : "Neuer Termin"}
      onClose={onClose}
      footer={
        readOnly ? (
          <Button onClick={onClose}>Schließen</Button>
        ) : (
          <>
            {event && <Button variant="danger" icon={<Trash2 size={17} />} loading={busy === "delete"} onClick={remove}>Löschen</Button>}
            <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
          </>
        )
      }
    >
      <div className="stack">
        {readOnly && (
          <Notice icon={<Smartphone size={17} />}>Dieser Termin kommt aus deinem iPhone-Kalender. Ändern oder löschen kannst du ihn dort.</Notice>
        )}
        {event?.sync_state === "error" && <Notice tone="warning">Abgleich mit dem Kalender fehlgeschlagen: {event.sync_error}</Notice>}
        <Field label="Titel">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} autoFocus={!event} placeholder="z. B. Zahnarzt" />
        </Field>
        <Segmented<Area>
          full
          value={area}
          onChange={(v) => !readOnly && setArea(v)}
          options={[{ value: "privat", label: "Privat" }, { value: "beruflich", label: "Beruflich" }]}
        />
        <Toggle checked={allDay} onChange={(v) => !readOnly && setAllDay(v)} label="Ganztägig" disabled={readOnly} />
        <div className="form-grid">
          <Field label={allDay ? "Von" : "Datum"} className={allDay ? "" : "span-2"}>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={readOnly} />
          </Field>
          {allDay ? (
            <Field label="Bis">
              <input className="input" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} disabled={readOnly} />
            </Field>
          ) : (
            <>
              <Field label="Beginn">
                <input className="input" type="time" value={from} onChange={(e) => { setTo(addMinutes(e.target.value, 60)); setFrom(e.target.value); }} disabled={readOnly} />
              </Field>
              <Field label="Ende">
                <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} disabled={readOnly} />
              </Field>
            </>
          )}
        </div>
        <div className="form-grid">
          <Field label="Art">
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value as EventKind)} disabled={readOnly}>
              {(Object.keys(KIND_LABELS) as EventKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Erinnerung">
            <select className="select" value={reminder} onChange={(e) => setReminder(e.target.value)} disabled={readOnly || allDay}>
              <option value="none">Keine</option>
              <option value="0">Zum Beginn</option>
              <option value="10">10 Min. vorher</option>
              <option value="15">15 Min. vorher</option>
              <option value="30">30 Min. vorher</option>
              <option value="60">1 Std. vorher</option>
              <option value="1440">1 Tag vorher</option>
            </select>
          </Field>
        </div>
        <Field label="Ort">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} disabled={readOnly} placeholder="optional" />
        </Field>
        <Field label="Notizen">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} rows={3} />
        </Field>
      </div>
    </Sheet>
  );
}
