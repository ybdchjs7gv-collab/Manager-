import { PenSquare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/Layout";
import { Composer } from "../components/mail/Composer";
import { MailDetail } from "../components/mail/MailDetail";
import { MailList } from "../components/mail/MailList";
import { Button, Segmented, useAction, useToast } from "../components/ui";
import { ChatDetail, ChatList } from "../components/whatsapp/ChatViews";
import { db } from "../lib/db";
import { invalidate, useLive } from "../lib/hooks";
import { navigate } from "../lib/router";

interface SyncReport {
  accounts: { account: string; fetched: number; remaining: number; error?: string }[];
}

export function MessagesPage({ route }: { route: string[] }) {
  const [tab, id] = route;
  const view = tab === "whatsapp" ? "whatsapp" : "mail";
  const [compose, setCompose] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const email = useLive(["emails"], async () => (tab === "mail" && id ? (await db().list("emails", { where: [["id", "eq", id]] }))[0] ?? null : null), [tab, id]);
  const chat = useLive(["chats"], async () => (tab === "whatsapp" && id ? (await db().list("chats", { where: [["id", "eq", id]] }))[0] ?? null : null), [tab, id]);
  const lastSync = useLive(["mail_accounts"], async () => {
    const accounts = await db().list("mail_accounts", { order: [["last_sync_at", "desc"]] });
    return accounts[0]?.last_sync_at ?? null;
  });

  const sync = () =>
    run("sync", async () => {
      const report = await db().invoke<SyncReport>("mail-sync", {});
      invalidate("emails", "mail_accounts");
      const fetched = report.accounts.reduce((s, a) => s + a.fetched, 0);
      const errors = report.accounts.filter((a) => a.error);
      if (errors.length > 0) toast.error(errors.map((e) => `${e.account}: ${e.error}`).join("\n"));
      else toast.show(fetched > 0 ? `${fetched} neue E-Mails – die KI sortiert sie jetzt` : "Keine neuen E-Mails");
    });

  const subtitle = view === "mail"
    ? lastSync.data ? `Abgerufen ${new Date(lastSync.data).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr · alle 5 Min. automatisch` : undefined
    : "Chats zusammenfassen und To-dos übernehmen";

  return (
    <div>
      <PageHeader
        title="Nachrichten"
        subtitle={subtitle}
        actions={
          view === "mail" ? (
            <>
              <Button icon={<PenSquare size={18} />} aria-label="Neue E-Mail" onClick={() => setCompose(true)} />
              <Button icon={<RefreshCw size={18} />} loading={busy === "sync"} onClick={sync}>Abrufen</Button>
            </>
          ) : undefined
        }
      />
      <div style={{ marginBottom: 14 }}>
        <Segmented
          value={view}
          onChange={(v) => navigate(v === "mail" ? "nachrichten" : "nachrichten/whatsapp")}
          options={[{ value: "mail", label: "E-Mail" }, { value: "whatsapp", label: "WhatsApp" }]}
        />
      </div>
      {view === "mail" ? <MailList /> : <ChatList />}
      {email.data && <MailDetail email={email.data} onClose={() => navigate("nachrichten")} />}
      {chat.data && <ChatDetail chat={chat.data} onClose={() => navigate("nachrichten/whatsapp")} />}
      {compose && <Composer onClose={() => setCompose(false)} />}
    </div>
  );
}
