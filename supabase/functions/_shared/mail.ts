// E-Mail-Abgleich: abrufen, mit KI einordnen, automatisch aufräumen.
import { aiClientFor, AiError, callJson, resolveModel } from "./ai.ts";
import { ruleCategory } from "./bulk.ts";
import { pushPending } from "./calsync.ts";
import { createEvents, createTasks } from "./events.ts";
import { errorMessage, mapLimit } from "./http.ts";
import {
  changeFlags,
  detectFolders,
  fetchFlags,
  fetchNewMessages,
  friendlyMailError,
  type ImapClient,
  moveMessages,
  withImap,
} from "./imap.ts";
import {
  type EmailClassification,
  emailClassificationSchema,
  emailClassificationSystem,
  emailClassificationUser,
} from "./prompts.ts";
import { type Admin, loadSettings, readSecret } from "./supabase.ts";
import { truncate } from "./text.ts";
import { formatGerman } from "./time.ts";

export interface MailAccount {
  id: string;
  user_id: string;
  label: string;
  email: string;
  area: "privat" | "beruflich";
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  username: string;
  folder: string;
  trash_folder: string | null;
  sent_folder: string | null;
  uid_validity: number | null;
  last_uid: number;
  enabled: boolean;
}

export interface EmailRow {
  id: string;
  user_id: string;
  account_id: string;
  folder: string;
  uid: number;
  uid_validity: number;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  from_name: string | null;
  from_email: string | null;
  to_list: string | null;
  cc_list: string | null;
  reply_to: string | null;
  subject: string | null;
  sent_at: string | null;
  body_text: string | null;
  attachment_names: string[];
  is_bulk: boolean;
  list_unsubscribe: string | null;
  unsubscribe_one_click: boolean;
  area: "privat" | "beruflich" | null;
  category: string | null;
  status: string;
}

export interface SyncReport {
  account: string;
  fetched: number;
  remaining: number;
  error?: string;
}

export async function accountPassword(admin: Admin, accountId: string): Promise<string | null> {
  return await readSecret(admin, `mail:${accountId}`);
}

export async function syncAccount(admin: Admin, acc: MailAccount): Promise<SyncReport> {
  const password = await accountPassword(admin, acc.id);
  if (!password) {
    await admin.from("mail_accounts").update({ last_error: "Kein Passwort gespeichert" }).eq("id", acc.id);
    return { account: acc.label, fetched: 0, remaining: 0, error: "Kein Passwort gespeichert" };
  }
  try {
    return await withImap(acc, password, async (client) => {
      const updates: Record<string, unknown> = {};
      if (!acc.trash_folder || !acc.sent_folder) {
        const folders = await detectFolders(client);
        updates.trash_folder = acc.trash_folder ?? folders.trash;
        updates.sent_folder = acc.sent_folder ?? folders.sent;
      }
      const res = await fetchNewMessages(
        client,
        acc.folder,
        { uidValidity: acc.uid_validity, lastUid: Number(acc.last_uid ?? 0) },
        { batch: 25, sinceDays: 14, initialMax: 60 },
      );
      if (res.messages.length > 0) {
        const rows = res.messages.map((m) => ({
          user_id: acc.user_id,
          account_id: acc.id,
          folder: acc.folder,
          uid: m.uid,
          uid_validity: res.uidValidity,
          message_id: m.messageId,
          in_reply_to: m.inReplyTo,
          references_header: m.references,
          from_name: m.fromName,
          from_email: m.fromEmail,
          to_list: m.to,
          cc_list: m.cc,
          reply_to: m.replyTo,
          subject: m.subject,
          sent_at: m.sentAt,
          snippet: m.snippet,
          body_text: m.bodyText,
          has_attachments: m.attachmentNames.length > 0,
          attachment_names: m.attachmentNames,
          is_read: m.seen,
          is_answered: m.answered,
          is_bulk: m.isBulk,
          list_unsubscribe: m.listUnsubscribe,
          unsubscribe_one_click: m.unsubscribeOneClick,
          area: acc.area,
          category: ruleCategory(m.isBulk, m.subject, m.bodyText),
          status: m.seen ? "gelesen" : "neu",
          ai_status: "pending",
        }));
        const { error } = await admin
          .from("emails")
          .upsert(rows, { onConflict: "account_id,folder,uid_validity,uid", ignoreDuplicates: true });
        if (error) throw new Error(`E-Mails speichern: ${error.message}`);
      }
      await reconcile(client, admin, acc, res.uidValidity);
      Object.assign(updates, {
        uid_validity: res.uidValidity,
        last_uid: res.lastUid,
        last_sync_at: new Date().toISOString(),
        last_error: null,
      });
      await admin.from("mail_accounts").update(updates).eq("id", acc.id);
      return { account: acc.label, fetched: res.messages.length, remaining: res.remaining };
    });
  } catch (err) {
    const message = friendlyMailError(err);
    await admin.from("mail_accounts").update({ last_error: message, last_sync_at: new Date().toISOString() }).eq("id", acc.id);
    return { account: acc.label, fetched: 0, remaining: 0, error: message };
  }
}

/** Mirrors changes made in other mail apps (read, deleted, moved). */
async function reconcile(
  client: ImapClient,
  admin: Admin,
  acc: MailAccount,
  uidValidity: number,
): Promise<void> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await admin
    .from("emails")
    .select("id, uid, is_read, status")
    .eq("account_id", acc.id)
    .eq("folder", acc.folder)
    .eq("uid_validity", uidValidity)
    .eq("deleted_on_server", false)
    .in("status", ["neu", "gelesen", "erledigt"])
    .gte("created_at", since)
    .limit(400);
  if (!data || data.length === 0) return;
  const flags = await fetchFlags(client, acc.folder, data.map((d) => Number(d.uid)));
  const gone: string[] = [];
  const nowRead: string[] = [];
  const nowUnread: string[] = [];
  for (const row of data) {
    const f = flags.get(Number(row.uid));
    if (!f) {
      gone.push(row.id);
      continue;
    }
    const seen = f.has("\\Seen");
    if (seen && !row.is_read) nowRead.push(row.id);
    if (!seen && row.is_read) nowUnread.push(row.id);
  }
  if (gone.length > 0) {
    await admin.from("emails").update({ deleted_on_server: true, status: "archiviert" }).in("id", gone);
  }
  if (nowRead.length > 0) {
    await admin.from("emails").update({ is_read: true }).in("id", nowRead);
    await admin.from("emails").update({ status: "gelesen" }).in("id", nowRead).eq("status", "neu");
  }
  if (nowUnread.length > 0) {
    await admin.from("emails").update({ is_read: false }).in("id", nowUnread);
  }
}

const JUNK = new Set(["newsletter", "werbung", "spam"]);

export interface ClassifyReport {
  classified: number;
  deleted: number;
  events: number;
  tasks: number;
  error?: string;
}

/** Sorts pending mails with AI and runs the automations chosen in the settings. */
export async function classifyPending(admin: Admin, userId: string, deadline: number): Promise<ClassifyReport> {
  const report: ClassifyReport = { classified: 0, deleted: 0, events: 0, tasks: 0 };
  const { data: pending, error } = await admin
    .from("emails")
    .select("*, mail_accounts(label, email, area)")
    .eq("user_id", userId)
    .eq("ai_status", "pending")
    .order("sent_at", { ascending: false })
    .limit(24);
  if (error) throw new Error(error.message);
  if (!pending || pending.length === 0) return report;

  const settings = await loadSettings(admin, userId);
  const client = await aiClientFor(admin, userId);
  if (!client) {
    await admin.from("emails").update({ ai_status: "skipped" }).in("id", pending.map((p) => p.id));
    return report;
  }

  const tz = settings.timezone;
  const today = formatGerman(new Date(), tz, true);
  const system = emailClassificationSystem(settings.display_name);
  const model = resolveModel(settings.ai_model_bulk);
  const toDelete: EmailRow[] = [];
  let fatal: string | null = null;

  await mapLimit(pending, 3, async (email) => {
    if (fatal || Date.now() > deadline) return;
    const account = email.mail_accounts as { label: string; email: string; area: string } | null;
    try {
      const result = await callJson<EmailClassification>(client, {
        purpose: "email_classify",
        model,
        effort: "low",
        system,
        schema: emailClassificationSchema,
        maxTokens: 4000,
        user: emailClassificationUser({
          today,
          accountLabel: account?.label ?? "",
          accountEmail: account?.email ?? "",
          accountArea: account?.area ?? "privat",
          bulk: email.is_bulk,
          fromName: email.from_name,
          fromEmail: email.from_email,
          to: email.to_list,
          subject: email.subject,
          date: email.sent_at ? formatGerman(new Date(email.sent_at), tz) : null,
          attachments: email.attachment_names ?? [],
          body: truncate(email.body_text ?? "", 8000),
        }),
      }, { admin, userId });

      await admin.from("emails").update({
        area: result.area,
        category: result.category,
        priority: result.priority,
        needs_reply: result.needs_reply,
        ai_summary: result.summary,
        ai_action: result.action || null,
        ai_events: result.events,
        ai_tasks: result.tasks,
        ai_status: "done",
        ai_error: null,
      }).eq("id", email.id);
      report.classified++;

      const junk = JUNK.has(result.category);
      // Automatic deletion only for mails whose own headers mark them as mass mail.
      if (junk && email.is_bulk && settings.auto_delete_newsletters && email.status !== "geloescht") {
        toDelete.push(email as EmailRow);
      }
      if (!junk) {
        const origin = {
          area: result.area,
          source: "email" as const,
          sourceRef: email.id as string,
          description: `Aus E-Mail von ${email.from_name ?? email.from_email ?? "unbekannt"}: ${email.subject ?? ""}`,
        };
        if (settings.auto_add_events) {
          const sure = result.events.filter((ev) => ev.confidence === "hoch");
          report.events += (await createEvents(admin, userId, tz, sure, origin)).length;
        }
        if (settings.auto_create_tasks && result.tasks.length > 0) {
          report.tasks += await createTasks(admin, userId, result.tasks, origin);
        }
      }
    } catch (err) {
      const message = errorMessage(err);
      await admin.from("emails").update({ ai_status: "error", ai_error: message.slice(0, 300) }).eq("id", email.id);
      if (err instanceof AiError && /Schlüssel|Guthaben|Berechtigung/.test(message)) fatal = message;
    }
  });

  if (toDelete.length > 0) {
    const res = await deleteEmails(admin, userId, toDelete.map((e) => e.id));
    report.deleted = res.deleted;
  }
  if (report.events > 0) {
    await pushPending(admin, userId, tz).catch((err) => console.error("Kalender", errorMessage(err)));
  }
  if (fatal) report.error = fatal;
  return report;
}

/** Moves mails to the trash folder on the server and marks them as deleted. */
export async function deleteEmails(
  admin: Admin,
  userId: string,
  emailIds: string[],
): Promise<{ deleted: number; errors: string[] }> {
  const { data: emails, error } = await admin
    .from("emails")
    .select("id, account_id, folder, uid, uid_validity, deleted_on_server")
    .eq("user_id", userId)
    .in("id", emailIds);
  if (error) throw new Error(error.message);
  const byAccount = new Map<string, typeof emails>();
  for (const e of emails ?? []) {
    const list = byAccount.get(e.account_id) ?? [];
    list.push(e);
    byAccount.set(e.account_id, list);
  }
  let deleted = 0;
  const errors: string[] = [];
  for (const [accountId, list] of byAccount) {
    const { data: acc } = await admin.from("mail_accounts").select("*").eq("id", accountId).single();
    if (!acc) continue;
    const account = acc as MailAccount;
    const onServer = list.filter((e) => !e.deleted_on_server && Number(e.uid_validity) === Number(account.uid_validity));
    try {
      if (onServer.length > 0) {
        const password = await accountPassword(admin, account.id);
        if (!password) throw new Error("Kein Passwort gespeichert");
        await withImap(account, password, async (client) => {
          let trash = account.trash_folder;
          if (!trash) {
            trash = (await detectFolders(client)).trash;
            if (trash) await admin.from("mail_accounts").update({ trash_folder: trash }).eq("id", account.id);
          }
          const byFolder = new Map<string, number[]>();
          for (const e of onServer) byFolder.set(e.folder, [...(byFolder.get(e.folder) ?? []), Number(e.uid)]);
          for (const [folder, uids] of byFolder) {
            if (trash && trash !== folder) await moveMessages(client, folder, uids, trash);
            else await changeFlags(client, folder, uids, ["\\Deleted", "\\Seen"], true);
          }
        });
      }
      const ids = list.map((e) => e.id);
      await admin.from("emails").update({ status: "geloescht", deleted_on_server: true }).in("id", ids);
      deleted += ids.length;
    } catch (err) {
      errors.push(`${account.label}: ${friendlyMailError(err)}`);
    }
  }
  return { deleted, errors };
}

export async function loadAccounts(admin: Admin, userId: string, accountId?: string): Promise<MailAccount[]> {
  let query = admin.from("mail_accounts").select("*").eq("user_id", userId).eq("enabled", true);
  if (accountId) query = query.eq("id", accountId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MailAccount[];
}
