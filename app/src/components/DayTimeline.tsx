import { MapPin, RefreshCw, Smartphone } from "lucide-react";
import { formatTime } from "../lib/dates";
import type { CalEvent } from "../lib/types";
import { KindIcon } from "./KindIcon";

export interface TimelineItem {
  key: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  kind: string;
  area?: "privat" | "beruflich";
  location?: string | null;
  proposed?: boolean;
  done?: boolean;
  event?: CalEvent;
  note?: string;
}

export function eventToItem(e: CalEvent): TimelineItem {
  return {
    key: e.id,
    title: e.title,
    start: new Date(e.start_at),
    end: new Date(e.end_at),
    allDay: e.all_day,
    kind: e.kind,
    area: e.area,
    location: e.location,
    done: e.status === "done",
    event: e,
  };
}

export function DayTimeline({
  items,
  onSelect,
  showNow,
  emptyText = "Keine Termine",
}: {
  items: TimelineItem[];
  onSelect?: (item: TimelineItem) => void;
  showNow?: boolean;
  emptyText?: string;
}) {
  const allDay = items.filter((i) => i.allDay);
  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const now = Date.now();
  const nowIndex = showNow ? timed.findIndex((i) => i.start.getTime() > now) : -1;

  if (items.length === 0) return <p className="muted small" style={{ padding: "8px 0" }}>{emptyText}</p>;

  return (
    <div className="timeline">
      {allDay.length > 0 && (
        <div className="row wrap">
          {allDay.map((i) => (
            <button key={i.key} className="badge info" style={{ border: 0, cursor: "pointer", height: 26 }} onClick={() => onSelect?.(i)}>
              {i.title}
            </button>
          ))}
        </div>
      )}
      {timed.map((item, index) => (
        <div key={item.key}>
          {index === nowIndex && <NowLine />}
          <div className="tl-item">
            <div className="tl-time">{formatTime(item.start)}</div>
            <button
              type="button"
              className={`tl-block kind-${item.kind} ${item.proposed ? "proposed" : ""} ${item.done ? "done" : ""}`}
              onClick={() => onSelect?.(item)}
              disabled={!onSelect}
            >
              <KindIcon kind={item.kind} />
              <div className="grow stack tight" style={{ gap: 2 }}>
                <span className={`strong truncate ${item.done ? "done-text" : ""}`}>{item.title}</span>
                <span className="small muted row" style={{ gap: 6 }}>
                  {formatTime(item.start)}–{formatTime(item.end)}
                  {item.location && (
                    <>
                      <MapPin size={12} />
                      <span className="truncate">{item.location}</span>
                    </>
                  )}
                  {item.note && <span className="truncate">{item.note}</span>}
                </span>
              </div>
              {item.event?.source === "caldav" && <Smartphone size={15} className="faint" aria-label="Aus dem iPhone-Kalender" />}
              {item.event?.sync_state === "pending" && <RefreshCw size={14} className="faint" aria-label="Wird abgeglichen" />}
              {item.area && <span className={`area-dot ${item.area}`} title={item.area === "privat" ? "Privat" : "Beruflich"} />}
            </button>
          </div>
        </div>
      ))}
      {showNow && nowIndex === -1 && timed.length > 0 && timed[timed.length - 1].end.getTime() < now && <NowLine />}
    </div>
  );
}

function NowLine() {
  return (
    <div className="row" style={{ margin: "2px 0 6px", gap: 8 }}>
      <span className="tiny strong" style={{ color: "var(--danger)", width: 52, textAlign: "right" }}>{formatTime(new Date())}</span>
      <div style={{ flex: 1, height: 2, background: "var(--danger)", borderRadius: 2, opacity: 0.7 }} />
    </div>
  );
}
