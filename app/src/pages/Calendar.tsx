import { ChevronLeft, ChevronRight, Plus, RefreshCw, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";
import { DayTimeline, eventToItem } from "../components/DayTimeline";
import { type EventPreset, EventEditor } from "../components/EventEditor";
import { PageHeader } from "../components/Layout";
import { Button, Card, Loading, Segmented, useAction, useToast } from "../components/ui";
import { useAreaFilter } from "../lib/app-state";
import { addDaysStr, formatDayLong, formatTime, parseDateStr, startOfWeekStr, toDateStr, todayStr, WEEKDAY_LABELS } from "../lib/dates";
import { db } from "../lib/db";
import { invalidate, useLive, useMediaQuery } from "../lib/hooks";
import { eventsBetween } from "../lib/queries";
import { navigate } from "../lib/router";
import type { CalEvent } from "../lib/types";

type View = "tag" | "woche" | "liste";

export function CalendarPage() {
  const wide = useMediaQuery("(min-width: 900px)");
  const [view, setView] = useState<View>(wide ? "woche" : "tag");
  const [day, setDay] = useState(todayStr());
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [creating, setCreating] = useState<EventPreset | null>(null);
  const weekStart = startOfWeekStr(day);
  const range = view === "liste" ? [todayStr(), addDaysStr(todayStr(), 30)] : [weekStart, addDaysStr(weekStart, 7)];
  const events = useLive(["events"], () => eventsBetween(range[0], range[1]), [range[0], range[1]]);
  const connections = useLive(["calendar_connections"], () => db().list("calendar_connections"));
  const list = useAreaFilter(events.data);
  const { busy, run } = useAction();
  const toast = useToast();

  const sync = () =>
    run("sync", async () => {
      const res = await db().invoke<{ pulls: { connection: string; error?: string }[] }>("calendar-sync", { action: "sync" });
      invalidate("events", "calendar_connections");
      const errors = res.pulls.filter((p) => p.error);
      if (errors.length) toast.error(errors.map((e) => `${e.connection}: ${e.error}`).join("\n"));
      else toast.show("Kalender abgeglichen");
    });

  const shift = (days: number) => setDay(addDaysStr(day, days));

  return (
    <div>
      <PageHeader
        title="Kalender"
        subtitle={connections.data && connections.data.length > 0 ? "Verbunden mit deinem iPhone-Kalender" : undefined}
        actions={
          <>
            {connections.data && connections.data.length > 0 && (
              <Button icon={<RefreshCw size={18} />} aria-label="Abgleichen" loading={busy === "sync"} onClick={sync} />
            )}
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating({ date: day })}>Termin</Button>
          </>
        }
      />

      <div className="row between wrap" style={{ marginBottom: 12, gap: 10 }}>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[{ value: "tag", label: "Tag" }, { value: "woche", label: "Woche" }, { value: "liste", label: "Liste" }]}
        />
        {view !== "liste" && (
          <div className="row">
            <Button size="sm" icon={<ChevronLeft size={18} />} aria-label="Zurück" onClick={() => shift(view === "tag" ? -1 : -7)} />
            <Button size="sm" onClick={() => setDay(todayStr())}>Heute</Button>
            <Button size="sm" icon={<ChevronRight size={18} />} aria-label="Weiter" onClick={() => shift(view === "tag" ? 1 : 7)} />
          </div>
        )}
      </div>

      {events.loading && !events.data && <Loading rows={4} />}

      {view === "tag" && (
        <div className="stack">
          <DayStrip weekStart={weekStart} day={day} onSelect={setDay} events={list} />
          <Card
            title={formatDayLong(day)}
            action={<Button size="sm" variant="ghost" icon={<Wand2 size={16} />} onClick={() => navigate(`planer?tag=${day}`)}>Planen</Button>}
          >
            <DayTimeline
              items={list.filter((e) => {
                const [s, en] = eventDays(e);
                return s <= day && en >= day;
              }).map(eventToItem)}
              showNow={day === todayStr()}
              onSelect={(i) => i.event && setEditing(i.event)}
              emptyText="Keine Termine an diesem Tag."
            />
          </Card>
        </div>
      )}

      {view === "woche" && (
        <Card padded={false}>
          <WeekGrid weekStart={weekStart} events={list} onSelect={setEditing} onCreate={(date, time) => setCreating({ date, start: time })} />
        </Card>
      )}

      {view === "liste" && <Agenda events={list} onSelect={setEditing} />}

      {editing && <EventEditor event={editing} onClose={() => setEditing(null)} />}
      {creating && <EventEditor preset={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function eventDays(e: CalEvent): [string, string] {
  const start = toDateStr(new Date(e.start_at));
  const end = toDateStr(new Date(new Date(e.end_at).getTime() - 1));
  return [start, end < start ? start : end];
}

function DayStrip({ weekStart, day, onSelect, events }: { weekStart: string; day: string; onSelect: (d: string) => void; events: CalEvent[] }) {
  const today = todayStr();
  return (
    <div className="card" style={{ padding: 8 }}>
      <div className="day-strip">
        {WEEKDAY_LABELS.map((label, i) => {
          const date = addDaysStr(weekStart, i);
          const count = events.filter((e) => {
            const [s, en] = eventDays(e);
            return s <= date && en >= date;
          }).length;
          return (
            <button key={date} className={`day-cell ${date === day ? "active" : ""}`} onClick={() => onSelect(date)}>
              <span style={date === today && date !== day ? { color: "var(--danger)", fontWeight: 700 } : undefined}>{label}</span>
              <span className="num">{parseDateStr(date).getDate()}</span>
              <span className="marks">{Array.from({ length: Math.min(count, 3) }, (_, k) => <i key={k} />)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const HOUR_PX = 48;

function layoutDay(events: CalEvent[]): { event: CalEvent; col: number; cols: number }[] {
  const sorted = [...events].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const result: { event: CalEvent; col: number; cols: number }[] = [];
  let cluster: { event: CalEvent; col: number; cols: number }[] = [];
  let clusterEnd = 0;
  const columnsEnd: number[] = [];
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    cluster.forEach((c) => (c.cols = cols));
    result.push(...cluster);
    cluster = [];
    columnsEnd.length = 0;
  };
  for (const e of sorted) {
    const s = new Date(e.start_at).getTime();
    const en = new Date(e.end_at).getTime();
    if (cluster.length > 0 && s >= clusterEnd) flush();
    let col = columnsEnd.findIndex((end) => end <= s);
    if (col === -1) {
      col = columnsEnd.length;
      columnsEnd.push(en);
    } else columnsEnd[col] = en;
    cluster.push({ event: e, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, en);
  }
  flush();
  return result;
}

function WeekGrid({ weekStart, events, onSelect, onCreate }: {
  weekStart: string;
  events: CalEvent[];
  onSelect: (e: CalEvent) => void;
  onCreate: (date: string, time: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
  const timed = events.filter((e) => !e.all_day);
  const allDay = events.filter((e) => e.all_day);
  const [startHour, endHour] = useMemo(() => {
    let min = 7;
    let max = 22;
    for (const e of timed) {
      min = Math.min(min, new Date(e.start_at).getHours());
      max = Math.max(max, Math.min(24, new Date(e.end_at).getHours() + 1));
    }
    return [min, max];
  }, [timed]);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const today = todayStr();

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 720 }}>
        <div className="week-grid" style={{ borderTop: 0 }}>
          <div />
          {days.map((d) => (
            <div key={d} className="stack tight" style={{ padding: "10px 6px", borderLeft: "1px solid var(--border)", alignItems: "center" }}>
              <span className="tiny muted">{WEEKDAY_LABELS[days.indexOf(d)]}</span>
              <span className="strong" style={d === today ? { color: "var(--danger)" } : undefined}>{parseDateStr(d).getDate()}.</span>
              {allDay.filter((e) => { const [s, en] = eventDays(e); return s <= d && en >= d; }).map((e) => (
                <button key={e.id} className="badge info" style={{ border: 0, cursor: "pointer", maxWidth: "100%" }} onClick={() => onSelect(e)}>
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="week-grid">
          <div>
            {hours.map((h) => (
              <div key={h} className="week-hour">{String(h).padStart(2, "0")}:00</div>
            ))}
          </div>
          {days.map((d) => {
            const dayEvents = timed.filter((e) => toDateStr(new Date(e.start_at)) === d);
            return (
              <div key={d} className="week-col" style={{ background: d === today ? "color-mix(in srgb, var(--info-soft) 40%, transparent)" : undefined }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="week-hour"
                    style={{ cursor: "pointer" }}
                    onClick={() => onCreate(d, `${String(h).padStart(2, "0")}:00`)}
                  />
                ))}
                {layoutDay(dayEvents).map(({ event, col, cols }) => {
                  const s = new Date(event.start_at);
                  const e = new Date(event.end_at);
                  const top = ((s.getHours() - startHour) * 60 + s.getMinutes()) / 60 * HOUR_PX;
                  const height = Math.max(22, ((e.getTime() - s.getTime()) / 3_600_000) * HOUR_PX - 2);
                  return (
                    <button
                      key={event.id}
                      className={`week-event ${event.area}`}
                      style={{ top, height, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, right: "auto" }}
                      onClick={() => onSelect(event)}
                      title={event.title}
                    >
                      <div className="strong truncate">{event.title}</div>
                      <div className="faint">{formatTime(s)}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Agenda({ events, onSelect }: { events: CalEvent[]; onSelect: (e: CalEvent) => void }) {
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const [s] = eventDays(e);
    const key = s < todayStr() ? todayStr() : s;
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const days = [...byDay.keys()].sort();
  if (days.length === 0) return <Card><p className="muted">In den nächsten 30 Tagen stehen keine Termine an.</p></Card>;
  return (
    <div className="stack">
      {days.map((d) => (
        <Card key={d} title={formatDayLong(d)}>
          <DayTimeline items={byDay.get(d)!.map(eventToItem)} onSelect={(i) => i.event && onSelect(i.event)} />
        </Card>
      ))}
    </div>
  );
}
