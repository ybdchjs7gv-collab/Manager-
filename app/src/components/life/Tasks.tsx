import { CheckCircle2, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { setTaskDone } from "../../lib/actions";
import { useAreaFilter } from "../../lib/app-state";
import { addDaysStr, diffDays, relativeDay, todayStr } from "../../lib/dates";
import { db } from "../../lib/db";
import { useLive } from "../../lib/hooks";
import type { Task } from "../../lib/types";
import { TaskEditor } from "../TaskEditor";
import { AreaBadge, Badge, Button, Card, Check, Chips, Empty, Loading } from "../ui";

type Filter = "offen" | "erledigt";

export function TasksView() {
  const [filter, setFilter] = useState<Filter>("offen");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const tasks = useLive(["tasks"], () =>
    filter === "offen"
      ? db().list("tasks", { where: [["status", "in", ["offen", "geplant"]]], order: [["due_date", "asc"], ["priority", "desc"]] })
      : db().list("tasks", { where: [["status", "eq", "erledigt"]], order: [["completed_at", "desc"]], limit: 50 }), [filter]);
  const list = useAreaFilter(tasks.data);
  const today = todayStr();

  const groups = useMemo(() => {
    if (filter === "erledigt") return [{ title: "Erledigt", items: list }];
    const weekEnd = addDaysStr(today, 7);
    const g: { title: string; items: Task[] }[] = [
      { title: "Überfällig", items: [] },
      { title: "Heute", items: [] },
      { title: "Nächste 7 Tage", items: [] },
      { title: "Später", items: [] },
      { title: "Ohne Termin", items: [] },
    ];
    for (const t of list) {
      if (!t.due_date) g[4].items.push(t);
      else if (t.due_date < today) g[0].items.push(t);
      else if (t.due_date === today) g[1].items.push(t);
      else if (t.due_date <= weekEnd) g[2].items.push(t);
      else g[3].items.push(t);
    }
    g[4].items.sort((a, b) => b.priority - a.priority);
    return g.filter((x) => x.items.length > 0);
  }, [list, filter, today]);

  return (
    <div className="stack">
      <div className="row between">
        <Chips<Filter> value={filter} onChange={setFilter} options={[{ value: "offen", label: "Offen" }, { value: "erledigt", label: "Erledigt" }]} />
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setCreating(true)}>Aufgabe</Button>
      </div>
      {tasks.loading && !tasks.data ? (
        <Loading rows={4} />
      ) : groups.length === 0 ? (
        <Empty icon={<CheckCircle2 size={24} />} title={filter === "offen" ? "Alles erledigt!" : "Noch nichts erledigt"} />
      ) : (
        groups.map((g) => (
          <Card key={g.title} title={<>{g.title} <span className="muted small">{g.items.length}</span></>}>
            <div className="list">
              {g.items.map((t) => (
                <div key={t.id} className="list-row clickable" onClick={() => setEditing(t)}>
                  <Check done={t.status === "erledigt"} onToggle={() => void setTaskDone(t, t.status !== "erledigt")} label={`${t.title} erledigt`} />
                  <div className="grow stack tight" style={{ gap: 3 }}>
                    <span className={t.status === "erledigt" ? "done-text" : ""}>{t.title}</span>
                    <span className="row wrap small muted" style={{ gap: 6 }}>
                      {t.priority === 3 && <Badge tone="danger">wichtig</Badge>}
                      {t.status === "geplant" && <Badge tone="info">eingeplant</Badge>}
                      {t.due_date && (
                        <span style={diffDays(t.due_date, today) < 0 && t.status !== "erledigt" ? { color: "var(--danger)" } : undefined}>
                          bis {relativeDay(t.due_date)}
                        </span>
                      )}
                      <span>{t.duration_min} Min.</span>
                      {t.source === "email" && <span>· aus E-Mail</span>}
                      {t.source === "whatsapp" && <span>· aus WhatsApp</span>}
                    </span>
                  </div>
                  <AreaBadge area={t.area} />
                </div>
              ))}
            </div>
          </Card>
        ))
      )}
      {(editing || creating) && <TaskEditor task={editing ?? undefined} onClose={() => { setEditing(null); setCreating(false); }} />}
    </div>
  );
}
