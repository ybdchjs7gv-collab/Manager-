import { AlertTriangle, CheckCircle2, Mail, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { relativeStamp } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import type { Area, MailAccount } from "../../lib/types";
import { AreaBadge, Button, Card, Empty, Field, Notice, Segmented, Sheet, Toggle, useAction, useToast } from "../ui";

interface Provider {
  label: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string | null;
  smtp_port: number | null;
  passwordLabel: string;
  help: string[];
}

export const PROVIDERS: Record<string, Provider> = {
  tonline: {
    label: "T-Online",
    imap_host: "secureimap.t-online.de",
    imap_port: 993,
    smtp_host: "securesmtp.t-online.de",
    smtp_port: 465,
    passwordLabel: "E-Mail-Passwort",
    help: [
      "Du brauchst das E-Mail-Passwort der Telekom – nicht das Passwort für das Kundencenter.",
      "Festlegen unter: telekom.de → Kundencenter → E-Mail → „E-Mail-Passwort“.",
      "Benutzername ist deine komplette E-Mail-Adresse.",
    ],
  },
  gmx: {
    label: "GMX",
    imap_host: "imap.gmx.net",
    imap_port: 993,
    smtp_host: "mail.gmx.net",
    smtp_port: 465,
    passwordLabel: "GMX-Passwort",
    help: [
      "Einmalig erlauben: GMX im Browser öffnen → Einstellungen → POP3/IMAP Abruf → „POP3 und IMAP Zugriff erlauben“.",
      "Mit Zwei-Faktor-Anmeldung brauchst du ein Anwendungspasswort aus den GMX-Sicherheitseinstellungen.",
    ],
  },
  webde: {
    label: "WEB.DE",
    imap_host: "imap.web.de",
    imap_port: 993,
    smtp_host: "smtp.web.de",
    smtp_port: 465,
    passwordLabel: "WEB.DE-Passwort",
    help: [
      "Einmalig erlauben: WEB.DE im Browser öffnen → Einstellungen → POP3/IMAP Abruf → „POP3 und IMAP Zugriff erlauben“.",
      "Mit Zwei-Faktor-Anmeldung brauchst du ein Anwendungspasswort.",
    ],
  },
  icloud: {
    label: "iCloud (Apple Mail)",
    imap_host: "imap.mail.me.com",
    imap_port: 993,
    smtp_host: null,
    smtp_port: null,
    passwordLabel: "App-spezifisches Passwort",
    help: [
      "Auf account.apple.com → „Anmelden und Sicherheit“ → „App-spezifische Passwörter“ ein neues Passwort erstellen (Name z. B. „Manager“).",
      "Benutzername ist deine iCloud-Adresse. Klappt das nicht, nur den Teil vor dem @ eintragen.",
      "Antworten öffnen sich bei iCloud in Apple Mail (direktes Senden erlaubt Apple nur über einen Anschluss, den der Server nicht nutzen darf).",
    ],
  },
  gmail: {
    label: "Gmail",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    passwordLabel: "App-Passwort",
    help: ["Unter myaccount.google.com → Sicherheit → App-Passwörter ein Passwort erstellen (Zwei-Faktor-Anmeldung muss aktiv sein)."],
  },
  custom: {
    label: "Anderer Anbieter",
    imap_host: "",
    imap_port: 993,
    smtp_host: "",
    smtp_port: 465,
    passwordLabel: "Passwort",
    help: ["Die Serverdaten findest du in der Hilfe deines Anbieters (IMAP mit SSL, Port 993; SMTP mit SSL, Port 465)."],
  },
};

export function AccountsSettings() {
  const accounts = useLive(["mail_accounts"], () => db().list("mail_accounts", { order: [["created_at", "asc"]] }));
  const [editing, setEditing] = useState<MailAccount | "new" | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const sync = () =>
    run("sync", async () => {
      const report = await db().invoke<{ accounts: { account: string; fetched: number; error?: string }[] }>("mail-sync", {});
      invalidate("mail_accounts", "emails");
      const errors = report.accounts.filter((a) => a.error);
      if (errors.length) toast.error(errors.map((e) => `${e.account}: ${e.error}`).join("\n"));
      else toast.show(`${report.accounts.reduce((s, a) => s + a.fetched, 0)} neue E-Mails abgerufen`);
    });

  return (
    <div className="stack">
      <Notice>
        Die App liest deine Postfächer alle 5 Minuten über IMAP, sortiert neue Mails mit der KI in Privat/Beruflich und Kategorien und trägt Termine in
        deinen Kalender ein. Passwörter werden verschlüsselt im Tresor deines Servers gespeichert und nie im Browser angezeigt.
      </Notice>
      {(accounts.data ?? []).length === 0 ? (
        <Empty icon={<Mail size={24} />} title="Noch kein Postfach" text="Füge T-Online, GMX, WEB.DE oder iCloud hinzu." />
      ) : (
        <Card padded={false}>
          <div className="list">
            {accounts.data!.map((a) => (
              <button key={a.id} className="list-row" onClick={() => setEditing(a)}>
                {a.last_error ? <AlertTriangle size={20} color="var(--danger)" /> : <CheckCircle2 size={20} color="var(--success)" />}
                <div className="grow stack tight" style={{ gap: 2 }}>
                  <span className="row" style={{ gap: 6 }}><span className="strong truncate">{a.label}</span> <AreaBadge area={a.area} /></span>
                  <span className="small muted truncate">{a.email}</span>
                  <span className="small" style={{ color: a.last_error ? "var(--danger)" : "var(--text-faint)" }}>
                    {a.last_error ?? (a.last_sync_at ? `Abgerufen ${relativeStamp(a.last_sync_at)}` : "Noch nicht abgerufen")}
                    {!a.enabled && " · pausiert"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
      <div className="row wrap">
        <Button variant="primary" icon={<Plus size={17} />} onClick={() => setEditing("new")}>Postfach hinzufügen</Button>
        {(accounts.data ?? []).length > 0 && <Button icon={<RefreshCw size={17} />} loading={busy === "sync"} onClick={sync}>Jetzt abrufen</Button>}
      </div>
      {editing && <AccountSheet account={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AccountSheet({ account, onClose }: { account?: MailAccount; onClose: () => void }) {
  const [provider, setProvider] = useState(account?.provider ?? "tonline");
  const preset = PROVIDERS[provider] ?? PROVIDERS.custom;
  const [email, setEmail] = useState(account?.email ?? "");
  const [label, setLabel] = useState(account?.label ?? "");
  const [area, setArea] = useState<Area>(account?.area ?? "privat");
  const [username, setUsername] = useState(account?.username ?? "");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState(account?.imap_host ?? preset.imap_host);
  const [imapPort, setImapPort] = useState(String(account?.imap_port ?? preset.imap_port));
  const [smtpHost, setSmtpHost] = useState(account?.smtp_host ?? preset.smtp_host ?? "");
  const [smtpPort, setSmtpPort] = useState(String(account?.smtp_port ?? preset.smtp_port ?? 465));
  const [enabled, setEnabled] = useState(account?.enabled ?? true);
  const [advanced, setAdvanced] = useState(provider === "custom");
  const { busy, run } = useAction();
  const toast = useToast();

  const chooseProvider = (p: string) => {
    setProvider(p);
    const next = PROVIDERS[p];
    setImapHost(next.imap_host);
    setImapPort(String(next.imap_port));
    setSmtpHost(next.smtp_host ?? "");
    setSmtpPort(String(next.smtp_port ?? 465));
    setAdvanced(p === "custom");
    if (!label) setLabel(next.label.split(" ")[0]);
  };

  const save = () =>
    run("save", async () => {
      if (!email.includes("@")) throw new Error("Bitte die E-Mail-Adresse eintragen.");
      if (!account && !password) throw new Error("Bitte das Passwort eintragen.");
      const result = await db().invoke<{ smtp: string; messages: number }>("mail-action", {
        action: "save",
        account: {
          id: account?.id,
          provider,
          label: label.trim() || preset.label,
          email: email.trim(),
          area,
          username: (username || email).trim(),
          password: password || undefined,
          imap_host: imapHost.trim(),
          imap_port: Number(imapPort) || 993,
          imap_secure: true,
          smtp_host: smtpHost.trim() || null,
          smtp_port: smtpHost.trim() ? Number(smtpPort) || 465 : null,
          smtp_secure: true,
          enabled,
        },
      });
      invalidate("mail_accounts");
      toast.show(`Verbunden – ${result.messages} Mails im Posteingang. Die ersten werden jetzt geholt.`);
      if (result.smtp !== "ok" && result.smtp !== "nicht verfügbar") toast.error(`Senden nicht möglich: ${result.smtp}`);
      void db().invoke("mail-sync", { account_id: undefined }).then(() => invalidate("emails", "mail_accounts")).catch(() => undefined);
      onClose();
    });

  const remove = () =>
    run("delete", async () => {
      if (!account || !confirm(`Postfach „${account.label}“ entfernen? Die Mails im Postfach selbst bleiben erhalten.`)) return;
      await db().remove("mail_accounts", [["id", "eq", account.id]]);
      invalidate("mail_accounts", "emails");
      onClose();
    }, "Postfach entfernt");

  return (
    <Sheet
      title={account ? account.label : "Postfach hinzufügen"}
      onClose={onClose}
      footer={
        <>
          {account && <Button variant="danger" icon={<Trash2 size={16} />} loading={busy === "delete"} onClick={remove}>Entfernen</Button>}
          <Button variant="primary" loading={busy === "save"} onClick={save}>{account ? "Speichern" : "Verbinden"}</Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Anbieter">
          <select className="select" value={provider} onChange={(e) => chooseProvider(e.target.value)}>
            {Object.entries(PROVIDERS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </Field>
        <Notice>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {preset.help.map((h) => <li key={h}>{h}</li>)}
          </ul>
        </Notice>
        <Field label="E-Mail-Adresse">
          <input className="input" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); if (!account) setUsername(e.target.value); }} />
        </Field>
        <Field label={preset.passwordLabel} hint={account ? "Leer lassen, um das gespeicherte Passwort zu behalten." : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="form-grid">
          <Field label="Name in der App"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={preset.label} /></Field>
          <Field label="Bereich">
            <Segmented<Area> full value={area} onChange={setArea} options={[{ value: "privat", label: "Privat" }, { value: "beruflich", label: "Beruflich" }]} />
          </Field>
        </div>
        {account && <Toggle checked={enabled} onChange={setEnabled} label="Automatisch abrufen" />}
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Serverdaten ausblenden" : "Serverdaten anzeigen"}
        </button>
        {advanced && (
          <div className="form-grid">
            <Field label="Benutzername" className="span-2"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
            <Field label="IMAP-Server"><input className="input" value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></Field>
            <Field label="IMAP-Port"><input className="input" inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></Field>
            <Field label="SMTP-Server (Senden)"><input className="input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="leer = nicht senden" /></Field>
            <Field label="SMTP-Port" hint="465 (SSL). 587 ist auf dem Server gesperrt."><input className="input" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Sheet>
  );
}
