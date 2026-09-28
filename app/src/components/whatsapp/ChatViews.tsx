import { CalendarPlus, CheckSquare, Copy, HelpCircle, MessageCircle, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { addTask, createEvents } from "../../lib/actions";
import { callAi, useAiStatus } from "../../lib/ai";
import { useApp, useAreaFilter } from "../../lib/app-state";
import { formatDayShort, formatTime, relativeStamp } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import { navigate } from "../../lib/router";
import type { Chat } from "../../lib/types";
import { aiEventTimes, describeAiEvent } from "../mail/MailDetail";
import { AreaBadge, Badge, Button, Empty, Loading, Notice, Sheet, useAction, useToast } from "../ui";
import { ImportChat } from "./ImportChat";

export function ChatList() {
  const chats = useLive(["chats"], () => db().list("chats", { order: [["last_message_at", "desc"]] }));
  const list = useAreaFilter(chats.data);
  return (
    <div className="stack">
      <ImportChat onDone={(id) => navigate(`nachrichten/whatsapp/${id}`)} />
      <details className="card flat">
        <summary className="strong" style={{ cursor: "pointer" }}>So holst du einen Chat vom iPhone</summary>
        <ol className="steps" style={{ marginTop: 10 }}>
          <li>In WhatsApp den Chat öffnen und oben auf den Namen tippen.</li>
          <li>Ganz nach unten scrollen: <b>„Chat exportieren“</b> → <b>„Ohne Medien“</b>.</li>
          <li><b>„In Dateien sichern“</b> wählen (z. B. „Auf meinem iPhone“).</li>
          <li>Hier auf <b>„Chat importieren“</b> tippen und die Datei auswählen.</li>
        </ol>
        <p className="small muted" style={{ marginTop: 8 }}>
          WhatsApp bietet für private Nummern keinen offiziellen Zugang zum automatischen Mitlesen. Programme, die das trotzdem tun, verstoßen gegen die
          Nutzungsbedingungen und können zur Sperrung deiner Nummer führen – deshalb der sichere Weg über den Export. Beim nächsten Export werden nur neue
          Nachrichten ergänzt.
        </p>
      </details>
      {chats.loading && !chats.data ? (
        <Loading rows={3} />
      ) : list.length === 0 ? (
        <Empty icon={<MessageCircle size={24} />} title="Noch keine Chats" text="Importiere einen WhatsApp-Chat, um ihn zusammenfassen zu lassen." />
      ) : (
        <div className="grid-2">
          {list.map((c) => (
            <button key={c.id} className="card stack tight" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => navigate(`nachrichten/whatsapp/${c.id}`)}>
              <div className="row between">
                <span className="strong truncate">{c.name}</span>
                <span className="tiny muted nowrap">{relativeStamp(c.last_message_at)}</span>
              </div>
              <span className="small muted clamp-2">{c.summary ?? `${c.message_count} Nachrichten – noch nicht zusammengefasst`}</span>
              <div className="row wrap" style={{ gap: 4 }}>
                <AreaBadge area={c.area} />
                {c.open_questions.length > 0 && <Badge tone="warning">{c.open_questions.length} offene Fragen</Badge>}
                {c.todos.length > 0 && <Badge tone="info">{c.todos.length} To-dos</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatDetail({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const { settings } = useApp();
  const ai = useAiStatus();
  const messages = useLive(["chat_messages"], () =>
    db().list("chat_messages", { where: [["chat_id", "eq", chat.id]], order: [["sent_at", "desc"]], limit: 60 }), [chat.id]);
  const linked = useLive(["events", "tasks"], async () => ({
    events: await db().list("events", { where: [["source_ref", "eq", chat.id]] }),
    tasks: await db().list("tasks", { where: [["source_ref", "eq", chat.id]] }),
  }), [chat.id]);
  const { busy, run } = useAction();
  const toast = useToast();
  const me = settings.preferences.whatsapp_name;

  const summarize = (full: boolean) =>
    run("sum", async () => {
      await callAi("summarize_chat", { chat_id: chat.id, full });
      invalidate("chats", "tasks", "events");
    }, "Zusammenfassung aktualisiert");

  const remove = () =>
    run("delete", async () => {
      if (!confirm(`Chat „${chat.name}“ mit allen importierten Nachrichten löschen?`)) return;
      await db().remove("chats", [["id", "eq", chat.id]]);
      invalidate("chats");
      onClose();
    }, "Chat gelöscht");

  return (
    <Sheet
      title={chat.name}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Löschen</Button>
          {ai.data?.configured && (
            <Button variant="primary" icon={<RefreshCw size={16} />} loading={busy === "sum"} onClick={() => summarize(!chat.summary)}>
              {chat.summary ? "Neu zusammenfassen" : "Zusammenfassen"}
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="row wrap small muted">
          <AreaBadge area={chat.area} />
          <span>{chat.message_count} Nachrichten</span>
          {chat.last_import_at && <span>· importiert {relativeStamp(chat.last_import_at)}</span>}
        </div>
        {!ai.data?.configured && !chat.summary && <Notice>Für Zusammenfassungen die KI in den Einstellungen einschalten.</Notice>}
        {chat.summary && (
          <div className="summary-box stack tight">
            <span className="row small muted" style={{ gap: 6 }}><Sparkles size={14} /> Zusammenfassung</span>
            <span>{chat.summary}</span>
            {chat.key_points.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }} className="small">
                {chat.key_points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        )}
        {chat.open_questions.map((q) => (
          <Notice key={q} tone="warning" icon={<HelpCircle size={17} />}>{q}</Notice>
        ))}
        {chat.reply_suggestion && (
          <div className="card flat row between" style={{ gap: 10 }}>
            <span className="small grow"><b>Antwortvorschlag:</b> {chat.reply_suggestion}</span>
            <Button size="sm" icon={<Copy size={15} />} onClick={() => navigator.clipboard.writeText(chat.reply_suggestion!).then(() => toast.show("Kopiert – jetzt in WhatsApp einfügen"))}>
              Kopieren
            </Button>
          </div>
        )}
        {(chat.todos.length > 0 || chat.events.length > 0) && (
          <div className="list">
            {chat.events.map((ev) => {
              const done = linked.data?.events.some((e) => e.title === ev.title);
              return (
                <div className="list-row" key={`e-${ev.title}-${ev.start}`}>
                  <CalendarPlus size={19} style={{ color: "var(--k-termin)" }} />
                  <div className="grow stack tight" style={{ gap: 1 }}>
                    <span className="strong truncate">{ev.title}</span>
                    <span className="small muted">{describeAiEvent(ev)}</span>
                  </div>
                  {done ? <Badge tone="success">eingetragen</Badge> : (
                    <Button size="sm" onClick={() => run(`e-${ev.title}`, async () => {
                      const t = aiEventTimes(ev);
                      if (!t) throw new Error("Datum nicht lesbar");
                      await createEvents([{ title: ev.title, start_at: t.start.toISOString(), end_at: t.end.toISOString(), all_day: t.allDay, location: ev.location, area: chat.area, source: "whatsapp", source_ref: chat.id }]);
                    }, "Im Kalender eingetragen")}>In Kalender</Button>
                  )}
                </div>
              );
            })}
            {chat.todos.map((t) => {
              const done = linked.data?.tasks.some((x) => x.title === t.title);
              return (
                <div className="list-row" key={`t-${t.title}`}>
                  <CheckSquare size={19} style={{ color: "var(--k-aufgabe)" }} />
                  <div className="grow stack tight" style={{ gap: 1 }}>
                    <span className="strong truncate">{t.title}</span>
                    {t.due_date && <span className="small muted">bis {formatDayShort(t.due_date)}</span>}
                  </div>
                  {done ? <Badge tone="success">angelegt</Badge> : (
                    <Button size="sm" onClick={() => run(`t-${t.title}`, () => addTask({ title: t.title, due_date: t.due_date, duration_min: t.duration_min || 30, area: chat.area, source: "whatsapp", source_ref: chat.id }), "Aufgabe angelegt")}>
                      Als Aufgabe
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="section-title">Letzte Nachrichten</div>
        {messages.loading && !messages.data ? <Loading rows={3} /> : (
          <div className="stack tight">
            {[...(messages.data ?? [])].reverse().map((m) => (
              <div key={m.id} className={`bubble ${m.author === me ? "me" : ""}`}>
                {m.author !== me && <div className="tiny strong" style={{ color: "var(--privat)" }}>{m.author}</div>}
                {m.body}
                <div className="tiny faint" style={{ textAlign: "right" }}>{formatDayShort(m.sent_at)} {formatTime(m.sent_at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
