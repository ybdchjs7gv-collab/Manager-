import { Inbox, Sparkles, Trash2, UserMinus } from "lucide-react";
import { useMemo, useState } from "react";
import { deleteEmails } from "../../lib/actions";
import { useAreaFilter } from "../../lib/app-state";
import { relativeStamp } from "../../lib/dates";
import { db } from "../../lib/db";
import { useLive } from "../../lib/hooks";
import { inboxEmails, isImportant, isJunk } from "../../lib/queries";
import { href, navigate } from "../../lib/router";
import type { Email } from "../../lib/types";
import { AreaBadge, Badge, Button, Chips, Empty, ErrorNote, Loading, useAction } from "../ui";
import { CATEGORY_LABELS } from "./categories";

type Filter = "wichtig" | "antworten" | "termine" | "rechnungen" | "alle" | "newsletter";

const FILTERS: { value: Filter; label: string; test: (e: Email) => boolean }[] = [
  { value: "wichtig", label: "Wichtig", test: isImportant },
  { value: "antworten", label: "Antworten", test: (e) => e.needs_reply && !isJunk(e) },
  { value: "termine", label: "Termine", test: (e) => !isJunk(e) && (e.category === "termin" || e.ai_events.length > 0) },
  { value: "rechnungen", label: "Rechnungen & Ämter", test: (e) => e.category === "rechnung" || e.category === "behoerde" },
  { value: "alle", label: "Alle", test: (e) => !isJunk(e) },
  { value: "newsletter", label: "Newsletter & Werbung", test: isJunk },
];

export function MailList() {
  const emails = useLive(["emails"], inboxEmails);
  const accounts = useLive(["mail_accounts"], () => db().count("mail_accounts"));
  const list = useAreaFilter(emails.data);
  const [filter, setFilter] = useState<Filter>("wichtig");
  const { busy, run } = useAction();

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, list.filter(f.test).length])), [list]);
  const active = FILTERS.find((f) => f.value === filter)!;
  const shown = list.filter(active.test);

  if (accounts.data === 0) {
    return (
      <Empty
        icon={<Inbox size={24} />}
        title="Noch kein Postfach verbunden"
        text="Verbinde T-Online, GMX, WEB.DE oder iCloud – danach sortiert die App deine Mails automatisch."
        action={<a className="btn btn-primary" href={href("einstellungen/konten")}>Postfach verbinden</a>}
      />
    );
  }

  return (
    <div className="stack">
      <Chips options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} value={filter} onChange={setFilter} />
      <ErrorNote error={emails.error} />
      {filter === "newsletter" && shown.length > 0 && (
        <div className="row between card flat" style={{ padding: "10px 14px" }}>
          <span className="small muted">{shown.length} Newsletter & Werbemails</span>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={15} />}
            loading={busy === "all"}
            onClick={() => run("all", async () => {
              if (!confirm(`${shown.length} Mails in den Papierkorb verschieben?`)) return;
              const res = await deleteEmails(shown);
              if (res.errors.length) throw new Error(res.errors.join("\n"));
            }, "In den Papierkorb verschoben")}
          >
            Alle löschen
          </Button>
        </div>
      )}
      {emails.loading && !emails.data ? (
        <Loading rows={5} />
      ) : shown.length === 0 ? (
        <Empty icon={<Inbox size={24} />} title="Hier ist nichts" text={filter === "wichtig" ? "Keine wichtigen Nachrichten offen. 🎉" : undefined} />
      ) : (
        <div className="card pad-0">
          <div className="list">
            {shown.map((m) => (
              <MailRow
                key={m.id}
                email={m}
                junk={filter === "newsletter"}
                onUnsubscribe={() => run(`u-${m.id}`, async () => {
                  const res = await db().invoke<{ done: boolean; url?: string; mailto?: string }>("mail-action", { action: "unsubscribe", email_id: m.id });
                  if (res.url) window.open(res.url, "_blank", "noopener");
                  else if (res.mailto) window.location.href = res.mailto;
                  await deleteEmails([m]);
                }, "Abgemeldet und gelöscht")}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MailRow({ email, junk, onUnsubscribe }: { email: Email; junk: boolean; onUnsubscribe: () => void }) {
  return (
    <div className="list-row clickable" onClick={() => navigate(`nachrichten/mail/${email.id}`)}>
      <div className="mail-row grow">
        <span className={email.is_read ? "" : "unread-dot"} />
        <div className="stack tight" style={{ gap: 2, minWidth: 0 }}>
          <span className={`truncate ${email.is_read ? "" : "strong"}`}>{email.from_name || email.from_email}</span>
          <span className={`truncate small ${email.is_read ? "muted" : ""}`}>{email.subject}</span>
          <span className="small muted clamp-2">
            {email.ai_status === "pending" ? (
              <span className="row" style={{ gap: 4 }}><Sparkles size={12} /> wird sortiert …</span>
            ) : (
              email.ai_summary ?? email.snippet
            )}
          </span>
          <span className="row wrap" style={{ gap: 4, marginTop: 2 }}>
            <AreaBadge area={email.area} />
            {email.category && email.category !== "info" && <Badge>{CATEGORY_LABELS[email.category]}</Badge>}
            {email.needs_reply && <Badge tone="warning">Antwort</Badge>}
            {email.priority >= 3 && <Badge tone="danger">Dringend</Badge>}
          </span>
        </div>
        <div className="stack tight" style={{ alignItems: "flex-end" }}>
          <span className="tiny muted nowrap">{relativeStamp(email.sent_at)}</span>
          {junk && email.list_unsubscribe && (
            <Button
              size="sm"
              variant="ghost"
              icon={<UserMinus size={15} />}
              aria-label="Abbestellen"
              title="Abbestellen und löschen"
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
