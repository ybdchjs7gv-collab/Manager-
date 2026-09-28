import { CalendarDays, CheckSquare, Home, Plus, ShoppingCart, Sparkles, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { addShoppingItems, addTask, createEvents } from "../lib/actions";
import { callAi, loadAiStatus } from "../lib/ai";
import { addDaysStr, combine, formatDayShort, todayStr } from "../lib/dates";
import { db } from "../lib/db";
import { invalidate } from "../lib/hooks";
import { type QuickItem, parseQuickText } from "../lib/quickparse";
import { AreaBadge, Button, Sheet, useAction, useToast } from "./ui";

const TYPE_LABEL: Record<QuickItem["type"], { label: string; icon: typeof Plus }> = {
  event: { label: "Termin", icon: CalendarDays },
  task: { label: "Aufgabe", icon: CheckSquare },
  shopping: { label: "Einkauf", icon: ShoppingCart },
  chore: { label: "Haushalt", icon: Home },
};

function eventTimes(item: QuickItem): { start: Date; end: Date; allDay: boolean } {
  const day = item.start!.slice(0, 10);
  const allDay = item.all_day || item.start!.length <= 10;
  if (allDay) {
    const last = item.end && item.end.length >= 10 && item.end.slice(0, 10) >= day ? item.end.slice(0, 10) : day;
    return { start: combine(day, "00:00"), end: combine(addDaysStr(last, 1), "00:00"), allDay };
  }
  const start = combine(day, item.start!.slice(11, 16));
  const end = item.end && item.end.length >= 16 ? combine(item.end.slice(0, 10), item.end.slice(11, 16)) : null;
  return { start, end: end && end > start ? end : new Date(start.getTime() + 3_600_000), allDay };
}

function describe(item: QuickItem): string {
  if (item.type === "event" && item.start) {
    const date = item.start.slice(0, 10);
    return item.all_day || item.start.length <= 10
      ? `${formatDayShort(date)}, ganztägig`
      : `${formatDayShort(date)}, ${item.start.slice(11, 16)}${item.end ? `–${item.end.slice(11, 16)}` : ""} Uhr`;
  }
  if (item.type === "task") {
    return [item.due_date ? `bis ${formatDayShort(item.due_date)}` : "ohne Frist", item.duration_min ? `${item.duration_min} Min.` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (item.type === "shopping") return [item.quantity, item.category].filter(Boolean).join(" · ");
  if (item.type === "chore") return item.interval_days ? `alle ${item.interval_days} Tage` : "";
  return "";
}

export function QuickAdd({ placeholder }: { placeholder?: string }) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<QuickItem[] | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const analyse = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void run("parse", async () => {
      let parsed: QuickItem[] | null = null;
      try {
        const status = await loadAiStatus();
        if (status.configured) {
          parsed = (await callAi<{ items: QuickItem[] }>("quick_add", { text })).items;
          setUsedAi(true);
        }
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.length === 0) {
        parsed = parseQuickText(text);
        setUsedAi(false);
      }
      setItems(parsed);
    });
  };

  const save = () =>
    run("save", async () => {
      if (!items) return;
      const events = items.filter((i) => i.type === "event" && i.start);
      if (events.length > 0) {
        await createEvents(events.map((i) => {
          const times = eventTimes(i);
          return { title: i.title, start_at: times.start.toISOString(), end_at: times.end.toISOString(), all_day: times.allDay, area: i.area, location: i.location, source: "manual" as const };
        }));
      }
      for (const t of items.filter((i) => i.type === "task")) {
        await addTask({ title: t.title, area: t.area, priority: (t.priority ?? 2) as 1 | 2 | 3, duration_min: t.duration_min ?? 30, due_date: t.due_date });
      }
      const shopping = items.filter((i) => i.type === "shopping");
      if (shopping.length > 0) await addShoppingItems(shopping.map((s) => ({ name: s.title, quantity: s.quantity, category: s.category })));
      const chores = items.filter((i) => i.type === "chore");
      if (chores.length > 0) {
        await db().insert("chores", chores.map((c) => ({ title: c.title, interval_days: c.interval_days ?? 7, duration_min: c.duration_min ?? 20, next_due: todayStr() })));
        invalidate("chores");
      }
      toast.show(items.length === 1 ? "Eingetragen" : `${items.length} Einträge gespeichert`);
      setItems(null);
      setText("");
    });

  return (
    <>
      <form className="quick-add" onSubmit={analyse}>
        <Sparkles size={18} className="muted" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "Schnell eintragen: „Zahnarzt Di 10 Uhr“, „Milch kaufen“ …"}
          aria-label="Schnell eintragen"
          enterKeyHint="done"
        />
        <Button type="submit" variant="primary" size="sm" loading={busy === "parse"} icon={<Plus size={17} />} aria-label="Eintragen" />
      </form>
      {items && (
        <Sheet
          title="Das trage ich ein"
          onClose={() => setItems(null)}
          footer={
            <>
              <Button onClick={() => setItems(null)}>Abbrechen</Button>
              <Button variant="primary" loading={busy === "save"} disabled={items.length === 0} onClick={save}>Übernehmen</Button>
            </>
          }
        >
          <div className="stack">
            {!usedAi && <p className="small muted">Ohne KI erkannt – prüfe kurz, ob alles stimmt.</p>}
            {items.length === 0 && <p className="muted">Nichts erkannt.</p>}
            <div className="list">
              {items.map((item, index) => {
                const meta = TYPE_LABEL[item.type];
                return (
                  <div className="list-row" key={index}>
                    <meta.icon size={20} className="muted" />
                    <div className="grow stack tight">
                      <input
                        className="input"
                        value={item.title}
                        onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, title: e.target.value } : it)))}
                      />
                      <div className="row wrap small muted">
                        <span className="badge">{meta.label}</span>
                        {item.type !== "shopping" && <AreaBadge area={item.area} />}
                        <span>{describe(item)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" icon={<X size={18} />} aria-label="Entfernen" onClick={() => setItems(items.filter((_, i) => i !== index))} />
                  </div>
                );
              })}
            </div>
            {items.some((i) => i.type === "event") && (
              <p className="small muted">Termine landen auch in deinem iPhone-Kalender, sobald er verbunden ist.</p>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
