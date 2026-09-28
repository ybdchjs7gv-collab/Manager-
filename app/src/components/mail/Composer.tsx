import { Copy, ExternalLink, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { callAi, useAiStatus } from "../../lib/ai";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import type { Email, MailAccount } from "../../lib/types";
import { Button, Field, Notice, Sheet, useAction, useToast } from "../ui";

function canSend(account: MailAccount | undefined): boolean {
  return Boolean(account?.smtp_host) && account?.smtp_port !== 587 && account?.smtp_port !== 25;
}

function replyAddress(email: Email): string {
  return email.reply_to || email.from_email || "";
}

export function Composer({ reply, withAi, onClose }: { reply?: Email; withAi?: boolean; onClose: () => void }) {
  const accounts = useLive(["mail_accounts"], () => db().list("mail_accounts", { where: [["enabled", "eq", true]] }));
  const ai = useAiStatus();
  const [accountId, setAccountId] = useState<string>(reply?.account_id ?? "");
  const [to, setTo] = useState(reply ? replyAddress(reply) : "");
  const [subject, setSubject] = useState(reply?.subject ? (/^(re|aw):/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : "");
  const [body, setBody] = useState("");
  const [instruction, setInstruction] = useState("");
  const [drafted, setDrafted] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const account = accounts.data?.find((a) => a.id === (accountId || accounts.data?.[0]?.id));
  const direct = canSend(account);

  const draft = () =>
    run("draft", async () => {
      if (!reply) return;
      const result = await callAi<{ subject: string; body: string }>("draft_reply", { email_id: reply.id, instruction: instruction.trim() || undefined });
      setBody(result.body);
      if (result.subject) setSubject(result.subject);
      setDrafted(true);
    });

  const send = () =>
    run("send", async () => {
      if (!account) throw new Error("Bitte zuerst ein Postfach verbinden.");
      const result = await db().invoke<{ warnings: string[] }>("mail-action", {
        action: "send",
        account_id: account.id,
        to,
        subject,
        text: body,
        reply_to_email_id: reply?.id,
      });
      invalidate("emails");
      toast.show(result.warnings?.[0] ?? "Gesendet");
      onClose();
    });

  const autoDrafted = useRef(false);
  useEffect(() => {
    if (withAi && reply && ai.data?.configured && !autoDrafted.current) {
      autoDrafted.current = true;
      void draft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withAi, reply, ai.data?.configured]);

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const markDone = async () => {
    if (reply) {
      await db().update("emails", [["id", "eq", reply.id]], { status: "erledigt", needs_reply: false });
      invalidate("emails");
    }
  };

  return (
    <Sheet
      title={reply ? "Antworten" : "Neue E-Mail"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button
            icon={<Copy size={16} />}
            onClick={() => navigator.clipboard.writeText(body).then(() => toast.show("Text kopiert"), () => toast.error("Kopieren nicht möglich"))}
          >
            Kopieren
          </Button>
          <a className="btn btn-secondary" href={mailto} onClick={() => void markDone()}>
            <ExternalLink size={16} /> In Mail öffnen
          </a>
          {direct && (
            <Button variant="primary" icon={<Send size={16} />} loading={busy === "send"} disabled={!body.trim() || !to.trim()} onClick={send}>
              Senden
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        {(accounts.data?.length ?? 0) > 1 && (
          <Field label="Von">
            <select className="select" value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.data!.map((a) => (
                <option key={a.id} value={a.id}>{a.label} ({a.email})</option>
              ))}
            </select>
          </Field>
        )}
        {account && !direct && (
          <Notice>
            {account.label} kann nicht direkt aus der App senden (Apple erlaubt dafür nur einen Anschluss, den der Server nicht nutzen darf). Tippe auf „In Mail öffnen“ – die Antwort ist dort schon eingetragen.
          </Notice>
        )}
        <Field label="An">
          <input className="input" type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@beispiel.de" />
        </Field>
        <Field label="Betreff">
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        {reply && ai.data?.configured && (
          <div className="card flat stack" style={{ background: "var(--surface-2)" }}>
            <Field label="Was soll die Antwort sagen? (optional)" hint="z. B. „zusagen, aber erst ab 15 Uhr“ oder „höflich absagen“">
              <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Stichworte für die KI" />
            </Field>
            <Button variant={withAi && !drafted ? "primary" : "secondary"} icon={<Sparkles size={16} />} loading={busy === "draft"} onClick={draft}>
              {drafted ? "Neu formulieren" : "Antwort mit KI schreiben"}
            </Button>
          </div>
        )}
        <Field label="Nachricht">
          <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="Deine Antwort …" />
        </Field>
        {reply && (
          <details>
            <summary className="small muted" style={{ cursor: "pointer" }}>Ursprüngliche Nachricht anzeigen</summary>
            <div className="mail-body" style={{ marginTop: 8 }}>{reply.body_text}</div>
          </details>
        )}
      </div>
    </Sheet>
  );
}
