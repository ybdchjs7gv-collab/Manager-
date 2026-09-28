import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChefHat,
  Dumbbell,
  Home,
  Inbox,
  Lightbulb,
  Mail,
  MessageCircle,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AreaSwitch } from "../components/Layout";
import { DayTimeline, eventToItem, type TimelineItem } from "../components/DayTimeline";
import { EventEditor } from "../components/EventEditor";
import { QuickAdd } from "../components/QuickAdd";
import { TaskEditor } from "../components/TaskEditor";
import { AreaBadge, Button, Card, Check, Loading, useAction, useToast } from "../components/ui";
import { deleteEmails, markChoreDone, setTaskDone, toggleWorkoutDone } from "../lib/actions";
import { callAi, useAiStatus } from "../lib/ai";
import { useApp, useAreaFilter } from "../lib/app-state";
import { diffDays, formatDayLong, greeting, isoWeekday, relativeDay, todayStr } from "../lib/dates";
import { db } from "../lib/db";
import { useLive } from "../lib/hooks";
import { activeChores, activeWorkouts, eventsOnDay, inboxEmails, isImportant, isJunk, mealsBetween, openTasks, workoutLogs } from "../lib/queries";
import { href, navigate } from "../lib/router";
import type { CalEvent, Task } from "../lib/types";

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function TodayPage() {
  const { settings, saveSettings, demo } = useApp();
  const today = todayStr();
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [newTask, setNewTask] = useState(false);

  const events = useLive(["events"], () => eventsOnDay(today), [today]);
  const tasks = useLive(["tasks"], openTasks);
  const emails = useLive(["emails"], inboxEmails);
  const chores = useLive(["chores"], activeChores);
  const workouts = useLive(["workouts", "workout_logs"], async () => ({ list: await activeWorkouts(), logs: await workoutLogs(today, today) }), [today]);
  const meals = useLive(["meal_plan"], () => mealsBetween(today, today), [today]);
  const shoppingCount = useLive(["shopping_items"], () => db().count("shopping_items", [["checked", "eq", false]]));
  const chats = useLive(["chats"], () => db().list("chats", { order: [["last_message_at", "desc"]], limit: 20 }));
  const setup = useLive(["mail_accounts", "calendar_connections", "ai_status"], async () => ({
    mail: await db().count("mail_accounts"),
    calendar: await db().count("calendar_connections"),
  }));
  const ai = useAiStatus();

  const dayEvents = useAreaFilter(events.data);
  const openList = useAreaFilter(tasks.data);
  const mailList = useAreaFilter(emails.data);
  const chatList = useAreaFilter(chats.data);

  const important = mailList.filter(isImportant);
  const junk = (emails.data ?? []).filter((e) => isJunk(e) && e.status !== "geloescht");
  const todaysTasks = useMemo(
    () =>
      openList
        .filter((t) => (t.due_date && t.due_date <= today) || t.priority === 3)
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || b.priority - a.priority)
        .slice(0, 6),
    [openList, today],
  );
  const dueChores = (chores.data ?? []).filter((c) => c.next_due <= today);
  const weekday = isoWeekday(today);
  const todaysWorkouts = (workouts.data?.list ?? []).filter((w) => w.weekdays.includes(weekday));
  const doneWorkouts = new Set((workouts.data?.logs ?? []).map((l) => l.workout_id));
  const questions = chatList.flatMap((c) => c.open_questions.map((q) => ({ chat: c, q }))).slice(0, 3);

  const timeline: TimelineItem[] = dayEvents.map(eventToItem);
  const setupSteps = [
    { done: (setup.data?.mail ?? 0) > 0, label: "E-Mail-Postfächer verbinden", path: "einstellungen/konten" },
    { done: (setup.data?.calendar ?? 0) > 0, label: "iPhone-Kalender verbinden", path: "einstellungen/kalender" },
    { done: Boolean(ai.data?.configured), label: "KI einschalten (Claude-Schlüssel)", path: "einstellungen/ki" },
    { done: isStandalone(), label: "App auf den Home-Bildschirm legen", path: "einstellungen/app" },
  ];
  const showSetup = !demo && !settings.preferences.setup_dismissed && setup.data && setupSteps.some((s) => !s.done);

  return (
    <div className="stack loose">
      <div className="hero">
        <span className="page-subtitle">{formatDayLong(new Date())}</span>
        <h1 className="greeting">{greeting()}{settings.display_name ? `, ${settings.display_name}` : ""}!</h1>
        <div style={{ marginTop: 8 }}>
          <AreaSwitch />
        </div>
      </div>

      <QuickAdd />

      {showSetup && (
        <Card
          title="Einrichten"
          icon={<Sparkles size={18} />}
          action={<Button variant="ghost" size="sm" icon={<X size={16} />} aria-label="Ausblenden" onClick={() => saveSettings({ preferences: { ...settings.preferences, setup_dismissed: true } })} />}
        >
          <div className="progress" style={{ marginBottom: 8 }}>
            <div style={{ width: `${(setupSteps.filter((s) => s.done).length / setupSteps.length) * 100}%` }} />
          </div>
          {setupSteps.map((s) => (
            <a key={s.label} className="setup-step" href={href(s.path)} style={{ textDecoration: "none" }}>
              <CheckCircle2 size={22} color={s.done ? "var(--success)" : "var(--border-strong)"} />
              <span className={`grow ${s.done ? "done-text" : "strong"}`}>{s.label}</span>
              {!s.done && <ArrowRight size={17} className="muted" />}
            </a>
          ))}
        </Card>
      )}

      <div className="stat-grid">
        <button className="stat" onClick={() => navigate("nachrichten")}>
          <span className="value">{important.length}</span>
          <span className="label">wichtige Nachrichten</span>
        </button>
        <button className="stat" onClick={() => navigate("alltag/aufgaben")}>
          <span className="value">{todaysTasks.length}</span>
          <span className="label">Aufgaben für heute</span>
        </button>
        <button className="stat" onClick={() => navigate("kalender")}>
          <span className="value">{timeline.filter((t) => !t.allDay).length}</span>
          <span className="label">Termine heute</span>
        </button>
        <button className="stat" onClick={() => navigate("alltag/einkauf")}>
          <span className="value">{shoppingCount.data ?? 0}</span>
          <span className="label">auf der Einkaufsliste</span>
        </button>
      </div>

      <div className="grid-2">
        <Card
          title="Dein Tag"
          icon={<CalendarDays size={18} />}
          action={<Button size="sm" variant="primary" icon={<Wand2 size={16} />} onClick={() => navigate("planer")}>Tag planen</Button>}
        >
          {events.loading && !events.data ? (
            <Loading rows={2} />
          ) : (
            <DayTimeline
              items={timeline}
              showNow
              onSelect={(i) => i.event && setEditing(i.event)}
              emptyText="Heute stehen keine Termine an. Mit „Tag planen“ verteilt die App deine Aufgaben auf freie Zeiten."
            />
          )}
          <DayBriefing enabled={Boolean(ai.data?.configured)} />
        </Card>

        <Card title="Nachrichten" icon={<Inbox size={18} />} action={<a className="btn btn-ghost btn-sm" href={href("nachrichten")}>Alle</a>}>
          <div className="list">
            {important.slice(0, 4).map((m) => (
              <a key={m.id} className="list-row clickable" href={href(`nachrichten/mail/${m.id}`)} style={{ textDecoration: "none" }}>
                <Mail size={18} className="muted" />
                <div className="grow stack tight" style={{ gap: 2 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="strong truncate">{m.from_name ?? m.from_email}</span>
                    {m.needs_reply && <span className="badge warning">Antwort</span>}
                  </span>
                  <span className="small muted clamp-2">{m.ai_summary ?? m.subject}</span>
                </div>
              </a>
            ))}
            {questions.map(({ chat, q }) => (
              <a key={`${chat.id}-${q}`} className="list-row clickable" href={href(`nachrichten/whatsapp/${chat.id}`)} style={{ textDecoration: "none" }}>
                <MessageCircle size={18} className="muted" />
                <div className="grow stack tight" style={{ gap: 2 }}>
                  <span className="strong truncate">{chat.name}</span>
                  <span className="small muted clamp-2">{q}</span>
                </div>
              </a>
            ))}
            {important.length === 0 && questions.length === 0 && <p className="muted small">Nichts Dringendes – sehr gut! 🎉</p>}
          </div>
          {junk.length > 0 && <JunkCleaner count={junk.length} onClean={() => deleteEmails(junk)} />}
        </Card>

        <Card
          title="Aufgaben"
          icon={<CheckCircle2 size={18} />}
          action={<Button size="sm" variant="ghost" icon={<Plus size={16} />} onClick={() => setNewTask(true)}>Neu</Button>}
        >
          {tasks.loading && !tasks.data ? (
            <Loading rows={2} />
          ) : todaysTasks.length === 0 ? (
            <p className="muted small">Keine fälligen Aufgaben. <a href={href("alltag/aufgaben")}>Alle Aufgaben</a></p>
          ) : (
            <div className="list">
              {todaysTasks.map((t) => (
                <div key={t.id} className="list-row clickable" onClick={() => setEditTask(t)}>
                  <Check done={false} onToggle={() => void setTaskDone(t, true)} label={`${t.title} erledigt`} />
                  <div className="grow stack tight" style={{ gap: 2 }}>
                    <span className="truncate">{t.title}</span>
                    <span className="small muted row" style={{ gap: 6 }}>
                      {t.due_date && <span className={diffDays(t.due_date, today) < 0 ? "badge danger" : ""}>{diffDays(t.due_date, today) < 0 ? "überfällig" : relativeDay(t.due_date)}</span>}
                      {t.status === "geplant" && <span className="badge info">eingeplant</span>}
                      <span>{t.duration_min} Min.</span>
                    </span>
                  </div>
                  <AreaBadge area={t.area} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Alltag heute" icon={<Home size={18} />}>
          <div className="list">
            {(meals.data ?? []).map((m) => (
              <a key={m.id} className="list-row clickable" href={href("alltag/essen")} style={{ textDecoration: "none" }}>
                <ChefHat size={18} style={{ color: "var(--k-kochen)" }} />
                <span className="grow truncate">{m.title}</span>
                {m.prep_min && <span className="small muted">{m.prep_min} Min.</span>}
              </a>
            ))}
            {todaysWorkouts.map((w) => (
              <div key={w.id} className="list-row">
                <Check done={doneWorkouts.has(w.id)} onToggle={() => void toggleWorkoutDone(w.id, w.title, w.duration_min, today, !doneWorkouts.has(w.id))} label={`${w.title} erledigt`} />
                <Dumbbell size={18} style={{ color: "var(--k-sport)" }} />
                <span className={`grow truncate ${doneWorkouts.has(w.id) ? "done-text" : ""}`}>{w.title}</span>
                <span className="small muted">{w.duration_min} Min.</span>
              </div>
            ))}
            {dueChores.map((c) => (
              <div key={c.id} className="list-row">
                <Check done={false} onToggle={() => void markChoreDone(c)} label={`${c.title} erledigt`} />
                <Home size={18} style={{ color: "var(--k-haushalt)" }} />
                <span className="grow truncate">{c.title}</span>
                {c.next_due < today && <span className="badge warning">seit {relativeDay(c.next_due)}</span>}
              </div>
            ))}
            <a className="list-row clickable" href={href("alltag/einkauf")} style={{ textDecoration: "none" }}>
              <ShoppingCart size={18} style={{ color: "var(--k-einkauf)" }} />
              <span className="grow">Einkaufsliste</span>
              <span className="small muted">{shoppingCount.data ?? 0} Artikel</span>
            </a>
          </div>
        </Card>
      </div>

      {editing && <EventEditor event={editing} onClose={() => setEditing(null)} />}
      {(editTask || newTask) && <TaskEditor task={editTask ?? undefined} onClose={() => { setEditTask(null); setNewTask(false); }} />}
    </div>
  );
}

function JunkCleaner({ count, onClean }: { count: number; onClean: () => Promise<unknown> }) {
  const { busy, run } = useAction();
  return (
    <div className="row between" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <span className="small muted">{count} Newsletter & Werbung</span>
      <Button size="sm" variant="danger" icon={<Trash2 size={15} />} loading={busy === "clean"} onClick={() => run("clean", onClean, "Aufgeräumt – in den Papierkorb verschoben")}>
        Aufräumen
      </Button>
    </div>
  );
}

function DayBriefing({ enabled }: { enabled: boolean }) {
  const [result, setResult] = useState<{ briefing: string; tips: string[]; warnings: string[] } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!enabled) return null;
  const load = () =>
    run("brief", async () => {
      const today = todayStr();
      const [events, tasks, emails] = await Promise.all([eventsOnDay(today), openTasks(), inboxEmails()]);
      const context = [
        "Termine heute:",
        ...events.map((e) => `- ${e.all_day ? "ganztägig" : `${new Date(e.start_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}–${new Date(e.end_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`} ${e.title} (${e.area}${e.source === "planner" ? ", geplant" : ""})`),
        "Offene Aufgaben:",
        ...tasks.slice(0, 25).map((t) => `- ${t.title} (${t.area}, Priorität ${t.priority}, ${t.duration_min} Min.${t.due_date ? `, fällig ${t.due_date}` : ""})`),
        "Wichtige Nachrichten:",
        ...emails.filter(isImportant).slice(0, 10).map((m) => `- ${m.from_name ?? m.from_email}: ${m.ai_summary ?? m.subject}`),
      ].join("\n");
      setResult(await callAi("day_briefing", { context }));
    }).catch(toast.error);
  return (
    <div style={{ marginTop: 14 }}>
      {!result ? (
        <Button size="sm" variant="ghost" icon={<Lightbulb size={16} />} loading={busy === "brief"} onClick={load}>
          KI-Tagesbriefing
        </Button>
      ) : (
        <div className="summary-box stack tight">
          <span>{result.briefing}</span>
          {result.warnings.map((w) => <span key={w} className="small" style={{ color: "var(--warning)" }}>⚠︎ {w}</span>)}
          {result.tips.map((t) => <span key={t} className="small muted">• {t}</span>)}
        </div>
      )}
    </div>
  );
}
