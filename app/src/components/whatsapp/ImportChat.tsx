import { ClipboardPaste, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { callAi, loadAiStatus } from "../../lib/ai";
import { useApp } from "../../lib/app-state";
import { db } from "../../lib/db";
import { invalidate } from "../../lib/hooks";
import type { Area, Chat } from "../../lib/types";
import { messageHash, type ParsedChat, parseChatText, readChatFile } from "../../lib/whatsapp";
import { Button, Field, Notice, Segmented, Sheet, useAction, useToast } from "../ui";

async function saveChat(parsed: ParsedChat, name: string, area: Area): Promise<{ chat: Chat; added: number }> {
  let [chat] = await db().list("chats", { where: [["name", "eq", name]] });
  if (!chat) [chat] = await db().insert("chats", [{ name, area, participants: parsed.participants }]);
  const before = await db().count("chat_messages", [["chat_id", "eq", chat.id]]);
  const rows = await Promise.all(parsed.messages.map(async (m) => ({
    chat_id: chat.id,
    sent_at: m.sentAt.toISOString(),
    author: m.author,
    body: m.text,
    hash: await messageHash(m),
  })));
  await db().insertIgnoreDuplicates("chat_messages", rows, "chat_id,hash");
  const total = await db().count("chat_messages", [["chat_id", "eq", chat.id]]);
  const last = parsed.messages.reduce((max, m) => (m.sentAt > max ? m.sentAt : max), new Date(0));
  const participants = [...new Set([...chat.participants, ...parsed.participants])];
  const [updated] = await db().update("chats", [["id", "eq", chat.id]], {
    area,
    participants,
    message_count: total,
    last_message_at: chat.last_message_at && chat.last_message_at > last.toISOString() ? chat.last_message_at : last.toISOString(),
    last_import_at: new Date().toISOString(),
  });
  return { chat: updated ?? chat, added: total - before };
}

export function ImportChat({ onDone }: { onDone: (chatId: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { settings, saveSettings } = useApp();
  const [parsed, setParsed] = useState<ParsedChat | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState<Area>("privat");
  const [me, setMe] = useState(settings.preferences.whatsapp_name ?? "");
  const [paste, setPaste] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const accept = (chat: ParsedChat) => {
    setParsed(chat);
    setName(chat.name ?? (chat.participants.find((p) => p !== me) ?? "Chat"));
    if (!me && chat.participants.length > 0) {
      const known = settings.preferences.whatsapp_name;
      if (known && chat.participants.includes(known)) setMe(known);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    void run("read", async () => accept(await readChatFile(file)));
  };

  const importNow = () =>
    run("import", async () => {
      if (!parsed) return;
      if (me && me !== settings.preferences.whatsapp_name) {
        await saveSettings({ preferences: { ...settings.preferences, whatsapp_name: me } });
      }
      const { chat, added } = await saveChat(parsed, name.trim() || "Chat", area);
      invalidate("chats", "chat_messages");
      toast.show(added > 0 ? `${added} neue Nachrichten importiert` : "Keine neuen Nachrichten");
      setParsed(null);
      const status = await loadAiStatus().catch(() => null);
      if (status?.configured && added > 0) {
        toast.show("KI fasst den Chat zusammen …");
        try {
          const result = await callAi<{ events_created: number; tasks_created: number }>("summarize_chat", { chat_id: chat.id });
          invalidate("chats", "tasks", "events");
          const extras = [result.tasks_created ? `${result.tasks_created} Aufgaben` : "", result.events_created ? `${result.events_created} Termine` : ""].filter(Boolean);
          toast.show(extras.length ? `Zusammenfassung fertig – ${extras.join(" und ")} übernommen` : "Zusammenfassung fertig");
        } catch (err) {
          toast.error(err);
        }
      }
      onDone(chat.id);
    });

  return (
    <>
      <div className="row wrap">
        <input ref={fileRef} type="file" accept=".zip,.txt,application/zip,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        <Button variant="primary" icon={<FileUp size={17} />} loading={busy === "read"} onClick={() => fileRef.current?.click()}>
          Chat importieren
        </Button>
        <Button icon={<ClipboardPaste size={17} />} onClick={() => setPaste("")}>Text einfügen</Button>
      </div>

      {paste !== null && (
        <Sheet
          title="Chat-Text einfügen"
          onClose={() => setPaste(null)}
          footer={
            <Button
              variant="primary"
              onClick={() => {
                const chat = parseChatText(paste);
                if (chat.messages.length === 0) {
                  toast.error("Keine WhatsApp-Nachrichten erkannt. Bitte den exportierten Text einfügen.");
                  return;
                }
                setPaste(null);
                accept(chat);
              }}
            >
              Weiter
            </Button>
          }
        >
          <textarea className="textarea" rows={12} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="[28.09.26, 14:03:12] Anna: Hallo …" />
        </Sheet>
      )}

      {parsed && (
        <Sheet
          title="Chat importieren"
          onClose={() => setParsed(null)}
          footer={<Button variant="primary" loading={busy === "import"} onClick={importNow}>Importieren</Button>}
        >
          <div className="stack">
            <Notice>{parsed.messages.length} Nachrichten von {parsed.participants.length} Personen erkannt.</Notice>
            <Field label="Name des Chats">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Segmented<Area> full value={area} onChange={setArea} options={[{ value: "privat", label: "Privat" }, { value: "beruflich", label: "Beruflich" }]} />
            <Field label="Welcher Name bist du?" hint="Damit die KI weiß, welche Nachrichten von dir sind.">
              <select className="select" value={me} onChange={(e) => setMe(e.target.value)}>
                <option value="">– nicht angeben –</option>
                {parsed.participants.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </Field>
          </div>
        </Sheet>
      )}
    </>
  );
}
