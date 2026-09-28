import { CalendarPlus, Check, CheckSquare, Mail, MailOpen, Paperclip, Reply, Sparkles, Trash2, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { addTask, createEvents, deleteEmails, markEmailsRead, setEmailStatus } from "../../lib/actions";
import { useAiStatus } from "../../lib/ai";
import { addDaysStr, combine, formatDayShort, formatDate, formatTime } from "../../lib/dates";
import { db } from "../../lib/db";
import { useLive } from "../../lib/hooks";
import type { AiEvent, Email } from "../../lib/types";
import { AreaBadge, Badge, Button, Notice, Sheet, useAction, useToast } from "../ui";
import { CATEGORY_LABELS } from "./categories";
import { Composer } from "./Composer";

export function aiEventTimes(ev: AiEvent): { start: Date; end: Date; allDay: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(ev.start)) return null;
  const day = ev.start.slice(0, 10);
  if (ev.all_day || ev.start.length <= 10) {
    const last = ev.end && ev.end.slice(0, 10) >= day ? ev.end.slice(0, 10) : day;
    return { start: combine(day, "00:00"), end: combine(addDaysStr(last, 1), "00:00"), allDay: true };
  }
  const start = combine(day, ev.start.slice(11, 16));
  const end = ev.end && ev.end.length >= 16 ? combine(ev.end.slice(0, 10), ev.end.slice(11, 16)) : null;
  return { start, end: end && end > start ? end : new Date(start.getTime() + 3_600_000), allDay: false };
}

export function describeAiEvent(ev: AiEvent): string {
  const t = aiEventTimes(ev);
  if (!t) return ev.start;
  return t.allDay ? `${formatDayShort(t.start)}, ganztägig` : `${formatDayShort(t.start)}, ${formatTime(t.start)}–${formatTime(t.end)}`;
}

export function MailDetail({ email, onClose }: { email: Email; onClose: () => void }) {
  const ai = useAiStatus();
  const [composer, setComposer] = useState<null | "plain" | "ai">(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const account = useLive(["mail_accounts"], () => db().list("mail_accounts", { where: [["id", "eq", email.account_id]] }), [email.account_id]);
  const linked = useLive(["events", "tasks"], async () => ({
    events: await db().list("events", { where: [["source_ref", "eq", email.id]] }),
    tasks: await db().list("tasks", { where: [["source_ref", "eq", email.id]] }),
  }), [email.id]);

  useEffect(() => {
    if (!email.is_read) void markEmailsRead([email], true).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id]);

  const hasEvent = (ev: AiEvent) => linked.data?.events.some((e) => e.title === ev.title);
  const hasTask = (title: string) => linked.data?.tasks.some((t) => t.title === title);

  const addEvent = (ev: AiEvent) =>
    run(`ev-${ev.title}`, async () => {
      const t = aiEventTimes(ev);
      if (!t) throw new Error("Datum nicht lesbar");
      await createEvents([{
        title: ev.title,
        start_at: t.start.toISOString(),
        end_at: t.end.toISOString(),
        all_day: t.allDay,
        location: ev.location,
        area: email.area ?? "privat",
        source: "email",
        source_ref: email.id,
        description: `Aus E-Mail von ${email.from_name ?? email.from_email}: ${email.subject ?? ""}`,
      }]);
    }, "Im Kalender eingetragen");

  const unsubscribe = () =>
    run("unsub", async () => {
      const res = await db().invoke<{ done: boolean; url?: string; mailto?: string }>("mail-action", { action: "unsubscribe", email_id: email.id });
      if (res.done) toast.show("Abgemeldet");
      else if (res.url) window.open(res.url, "_blank", "noopener");
      else if (res.mailto) window.location.href = res.mailto;
    });

  const sender = email.from_name ? `${email.from_name} <${email.from_email}>` : email.from_email;

  return (
    <>
      <Sheet
        title={email.subject ?? "(ohne Betreff)"}
        onClose={onClose}
        wide
        footer={
          <>
            <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={() => run("delete", async () => { await deleteEmails([email]); onClose(); }, "In den Papierkorb verschoben")}>
              Löschen
            </Button>
            <Button icon={<Check size={16} />} loading={busy === "done"} onClick={() => run("done", async () => { await setEmailStatus([email], "erledigt"); onClose(); }, "Als erledigt markiert")}>
              Erledigt
            </Button>
            <Button variant="primary" icon={<Reply size={16} />} onClick={() => setComposer(ai.data?.configured ? "ai" : "plain")}>
              Antworten
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="stack tight">
            <div className="row wrap">
              <AreaBadge area={email.area} />
              {email.category && <Badge>{CATEGORY_LABELS[email.category] ?? email.category}</Badge>}
              {email.needs_reply && <Badge tone="warning">Antwort erwartet</Badge>}
              {email.priority >= 3 && <Badge tone="danger">Dringend</Badge>}
              {account.data?.[0] && <span className="small muted">{account.data[0].label}</span>}
            </div>
            <span className="strong">{sender}</span>
            <span className="small muted">{email.sent_at ? `${formatDate(email.sent_at)}, ${formatTime(email.sent_at)}` : ""}{email.to_list ? ` · an ${email.to_list}` : ""}</span>
          </div>

          {email.ai_status === "pending" && <Notice icon={<Sparkles size={17} />}>Die KI liest diese Nachricht gerade …</Notice>}
          {email.ai_status === "error" && <Notice tone="warning">KI-Auswertung fehlgeschlagen: {email.ai_error}</Notice>}
          {email.ai_summary && (
            <div className="summary-box stack tight">
              <span className="row small muted" style={{ gap: 6 }}><Sparkles size={14} /> Zusammenfassung</span>
              <span>{email.ai_summary}</span>
              {email.ai_action && <span className="strong">→ {email.ai_action}</span>}
            </div>
          )}

          {(email.ai_events.length > 0 || email.ai_tasks.length > 0) && (
            <div className="list">
              {email.ai_events.map((ev) => (
                <div className="list-row" key={`e-${ev.title}-${ev.start}`}>
                  <CalendarPlus size={19} style={{ color: "var(--k-termin)" }} />
                  <div className="grow stack tight" style={{ gap: 1 }}>
                    <span className="strong truncate">{ev.title}</span>
                    <span className="small muted">{describeAiEvent(ev)}{ev.location ? ` · ${ev.location}` : ""}</span>
                  </div>
                  {hasEvent(ev) ? <Badge tone="success">eingetragen</Badge> : <Button size="sm" loading={busy === `ev-${ev.title}`} onClick={() => addEvent(ev)}>In Kalender</Button>}
                </div>
              ))}
              {email.ai_tasks.map((t) => (
                <div className="list-row" key={`t-${t.title}`}>
                  <CheckSquare size={19} style={{ color: "var(--k-aufgabe)" }} />
                  <div className="grow stack tight" style={{ gap: 1 }}>
                    <span className="strong truncate">{t.title}</span>
                    <span className="small muted">{t.due_date ? `bis ${formatDayShort(t.due_date)} · ` : ""}{t.duration_min} Min.</span>
                  </div>
                  {hasTask(t.title) ? (
                    <Badge tone="success">angelegt</Badge>
                  ) : (
                    <Button size="sm" onClick={() => run(`t-${t.title}`, () => addTask({ title: t.title, due_date: t.due_date, duration_min: t.duration_min, area: email.area ?? "privat", source: "email", source_ref: email.id }), "Aufgabe angelegt")}>
                      Als Aufgabe
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="row wrap">
            <Button size="sm" icon={email.is_read ? <Mail size={15} /> : <MailOpen size={15} />} onClick={() => run("read", () => markEmailsRead([email], !email.is_read))}>
              {email.is_read ? "Als ungelesen" : "Als gelesen"}
            </Button>
            {ai.data?.configured && (
              <Button size="sm" icon={<Sparkles size={15} />} onClick={() => setComposer("ai")}>Antwort mit KI</Button>
            )}
            {email.list_unsubscribe && (
              <Button size="sm" icon={<UserMinus size={15} />} loading={busy === "unsub"} onClick={unsubscribe}>Abbestellen</Button>
            )}
          </div>

          {email.attachment_names.length > 0 && (
            <div className="row wrap small muted"><Paperclip size={14} /> {email.attachment_names.join(", ")}</div>
          )}
          <div className="mail-body">{email.body_text || email.snippet || "(kein Text)"}</div>
        </div>
      </Sheet>
      {composer && <Composer reply={email} withAi={composer === "ai"} onClose={() => setComposer(null)} />}
    </>
  );
}
