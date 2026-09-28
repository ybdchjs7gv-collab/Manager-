// Aktionen rund um E-Mail: Postfach testen/speichern, senden, löschen,
// gelesen markieren, abbestellen.
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { appendMessage, changeFlags, detectFolders, friendlyMailError, type ImapAccount, withImap } from "../_shared/imap.ts";
import { accountPassword, deleteEmails, type MailAccount } from "../_shared/mail.ts";
import { bareAddress, buildRawMessage, canSendDirectly, sendRaw, splitAddresses, verifySmtp } from "../_shared/smtp.ts";
import { unsubscribeTarget } from "../_shared/bulk.ts";
import { type Admin, adminClient, requireUser } from "../_shared/supabase.ts";

interface AccountInput {
  id?: string;
  label?: string;
  email?: string;
  area?: "privat" | "beruflich";
  provider?: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean;
  username?: string;
  password?: string;
  folder?: string;
  enabled?: boolean;
}

function toImap(input: AccountInput): ImapAccount {
  if (!input.imap_host || !input.username) throw new HttpError(400, "Server und Benutzername fehlen.");
  return {
    imap_host: input.imap_host.trim(),
    imap_port: Number(input.imap_port ?? 993),
    imap_secure: input.imap_secure ?? true,
    username: input.username.trim(),
    folder: input.folder?.trim() || "INBOX",
  };
}

async function testConnection(input: AccountInput, password: string) {
  const imap = toImap(input);
  let folders;
  try {
    folders = await withImap(imap, password, async (client) => {
      const found = await detectFolders(client);
      const status = await client.status(imap.folder, { messages: true });
      return { ...found, messages: status.messages ?? 0 };
    });
  } catch (err) {
    throw new HttpError(400, friendlyMailError(err));
  }
  let smtp = "nicht verfügbar";
  const smtpAccount = {
    smtp_host: input.smtp_host ?? null,
    smtp_port: input.smtp_port ?? null,
    smtp_secure: input.smtp_secure ?? true,
    username: imap.username,
    email: input.email ?? imap.username,
    label: input.label ?? "",
  };
  if (canSendDirectly(smtpAccount)) {
    try {
      await verifySmtp(smtpAccount, password);
      smtp = "ok";
    } catch (err) {
      smtp = friendlyMailError(err);
    }
  }
  return { folders, smtp };
}

async function ownAccount(admin: Admin, userId: string, accountId: string): Promise<MailAccount> {
  const { data } = await admin.from("mail_accounts").select("*").eq("id", accountId).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(404, "Postfach nicht gefunden");
  return data as MailAccount;
}

function isPublicHttps(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return false;
  return true;
}

serve(async (req) => {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<Record<string, unknown>>(req);
  const action = String(body.action ?? "");

  switch (action) {
    case "test": {
      const input = body.account as AccountInput;
      if (!input?.password) throw new HttpError(400, "Passwort fehlt.");
      return json({ ok: true, ...(await testConnection(input, input.password)) });
    }

    case "save": {
      const input = (body.account ?? {}) as AccountInput;
      const existing = input.id ? await ownAccount(admin, user.id, input.id) : null;
      const password = input.password || (existing ? await accountPassword(admin, existing.id) : null);
      if (!password) throw new HttpError(400, "Bitte das Passwort eingeben.");
      const test = await testConnection({ ...existing, ...input } as AccountInput, password);
      const imap = toImap({ ...existing, ...input } as AccountInput);
      const hostChanged = existing &&
        (existing.imap_host !== imap.imap_host || existing.username !== imap.username || existing.folder !== imap.folder);
      const row = {
        user_id: user.id,
        label: input.label?.trim() || existing?.label || imap.username,
        email: (input.email ?? existing?.email ?? imap.username).trim().toLowerCase(),
        area: input.area ?? existing?.area ?? "privat",
        provider: input.provider ?? existing?.provider ?? "custom",
        imap_host: imap.imap_host,
        imap_port: imap.imap_port,
        imap_secure: imap.imap_secure,
        smtp_host: input.smtp_host !== undefined ? input.smtp_host : existing?.smtp_host ?? null,
        smtp_port: input.smtp_port !== undefined ? input.smtp_port : existing?.smtp_port ?? 465,
        smtp_secure: input.smtp_secure ?? existing?.smtp_secure ?? true,
        username: imap.username,
        folder: imap.folder,
        trash_folder: test.folders.trash,
        sent_folder: test.folders.sent,
        enabled: input.enabled ?? existing?.enabled ?? true,
        last_error: null,
        ...(hostChanged ? { uid_validity: null, last_uid: 0 } : {}),
      };
      const saved = existing
        ? await admin.from("mail_accounts").update(row).eq("id", existing.id).select("*").single()
        : await admin.from("mail_accounts").insert(row).select("*").single();
      if (saved.error) throw new Error(saved.error.message);
      if (input.password) {
        const { error } = await admin.rpc("admin_set_secret", { p_name: `mail:${saved.data.id}`, p_secret: input.password });
        if (error) throw new Error(`Passwort nicht gespeichert: ${error.message}`);
      }
      return json({ ok: true, account: saved.data, smtp: test.smtp, messages: test.folders.messages });
    }

    case "send": {
      const account = await ownAccount(admin, user.id, String(body.account_id ?? ""));
      if (!canSendDirectly(account)) {
        throw new HttpError(400, "Dieses Postfach kann nicht direkt aus der App senden. Bitte „In Mail öffnen“ verwenden.");
      }
      const to = splitAddresses(body.to as string | string[]);
      const cc = splitAddresses(body.cc as string | string[]);
      if (to.length === 0) throw new HttpError(400, "Bitte mindestens eine Empfängeradresse angeben.");
      const subject = String(body.subject ?? "").trim() || "(ohne Betreff)";
      const text = String(body.text ?? "").trim();
      if (!text) throw new HttpError(400, "Die Nachricht ist leer.");

      let original: Record<string, unknown> | null = null;
      if (body.reply_to_email_id) {
        const { data } = await admin.from("emails").select("*").eq("id", String(body.reply_to_email_id)).eq("user_id", user.id)
          .maybeSingle();
        original = data;
      }
      const { data: settings } = await admin.from("settings").select("display_name").eq("user_id", user.id).maybeSingle();
      const references = original ? [original.references_header, original.message_id].filter(Boolean).join(" ") : null;
      const raw = await buildRawMessage(account, {
        fromName: (settings?.display_name as string | null) ?? null,
        to,
        cc,
        subject,
        text,
        inReplyTo: (original?.message_id as string | null) ?? null,
        references,
      });
      const password = await accountPassword(admin, account.id);
      if (!password) throw new HttpError(400, "Für dieses Postfach ist kein Passwort gespeichert.");
      try {
        await sendRaw(account, password, { from: account.email, to: [...to, ...cc].map(bareAddress) }, raw);
      } catch (err) {
        throw new HttpError(400, `Senden fehlgeschlagen: ${friendlyMailError(err)}`);
      }

      // Copy to "Gesendet" and mark the original as answered (best effort).
      const warnings: string[] = [];
      try {
        await withImap(account, password, async (client) => {
          const sent = account.sent_folder ?? (await detectFolders(client)).sent;
          if (sent && account.provider !== "gmail") await appendMessage(client, sent, raw, ["\\Seen"]);
          if (original && !original.deleted_on_server && Number(original.uid_validity) === Number(account.uid_validity)) {
            await changeFlags(client, String(original.folder), [Number(original.uid)], ["\\Answered", "\\Seen"], true);
          }
        });
      } catch (err) {
        warnings.push(`Kopie in „Gesendet“ nicht möglich: ${friendlyMailError(err)}`);
      }
      if (original) {
        await admin.from("emails").update({ is_answered: true, is_read: true, needs_reply: false, status: "erledigt" }).eq(
          "id",
          original.id as string,
        );
      }
      return json({ ok: true, warnings });
    }

    case "delete": {
      const ids = (body.email_ids as string[] | undefined) ?? [];
      if (ids.length === 0) return json({ ok: true, deleted: 0 });
      const result = await deleteEmails(admin, user.id, ids.slice(0, 500));
      return json({ ok: result.errors.length === 0, ...result });
    }

    case "mark": {
      const ids = (body.email_ids as string[] | undefined) ?? [];
      const read = Boolean(body.read);
      const { data: emails } = await admin
        .from("emails")
        .select("id, account_id, folder, uid, uid_validity, deleted_on_server, status")
        .eq("user_id", user.id)
        .in("id", ids);
      const byAccount = new Map<string, NonNullable<typeof emails>>();
      for (const e of emails ?? []) byAccount.set(e.account_id, [...(byAccount.get(e.account_id) ?? []), e]);
      const errors: string[] = [];
      for (const [accountId, list] of byAccount) {
        const account = await ownAccount(admin, user.id, accountId);
        const password = await accountPassword(admin, account.id);
        const onServer = list.filter((e) => !e.deleted_on_server && Number(e.uid_validity) === Number(account.uid_validity));
        if (password && onServer.length > 0) {
          try {
            await withImap(account, password, async (client) => {
              await changeFlags(client, account.folder, onServer.map((e) => Number(e.uid)), ["\\Seen"], read);
            });
          } catch (err) {
            errors.push(`${account.label}: ${friendlyMailError(err)}`);
          }
        }
      }
      const found = (emails ?? []).map((e) => e.id);
      await admin.from("emails").update({ is_read: read }).in("id", found);
      if (read) await admin.from("emails").update({ status: "gelesen" }).in("id", found).eq("status", "neu");
      else await admin.from("emails").update({ status: "neu" }).in("id", found).eq("status", "gelesen");
      return json({ ok: errors.length === 0, errors });
    }

    case "unsubscribe": {
      const { data: email } = await admin.from("emails").select("*").eq("id", String(body.email_id ?? "")).eq("user_id", user.id)
        .maybeSingle();
      if (!email) throw new HttpError(404, "E-Mail nicht gefunden");
      const target = unsubscribeTarget(email.list_unsubscribe as string | null);
      if (!target) throw new HttpError(400, "Diese E-Mail enthält keinen Abmeldelink.");
      if (target.startsWith("https://")) {
        const url = new URL(target);
        if (email.unsubscribe_one_click && isPublicHttps(url)) {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
            redirect: "follow",
          });
          if (res.ok) {
            await res.body?.cancel();
            return json({ ok: true, done: true });
          }
          await res.body?.cancel();
        }
        return json({ ok: true, done: false, url: target });
      }
      return json({ ok: true, done: false, mailto: target });
    }

    default:
      throw new HttpError(400, `Unbekannte Aktion: ${action}`);
  }
});
