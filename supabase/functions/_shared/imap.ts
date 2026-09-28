// IMAP-Zugriff (T-Online, GMX, Web.de, iCloud …) über imapflow.
import { Buffer } from "node:buffer";
import { ImapFlow } from "npm:imapflow@1.7.8";
import PostalMime from "npm:postal-mime@2.7.6";
import { isBulkMail, parseHeaderBlock } from "./bulk.ts";
import { htmlToText, snippetOf, truncate } from "./text.ts";

export type ImapClient = ImapFlow;

export interface ImapAccount {
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  username: string;
  folder: string;
}

export function createImapClient(account: ImapAccount, password: string): ImapFlow {
  return new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.username, pass: password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
    clientInfo: { name: "Manager", version: "1.0" },
  });
}

export async function withImap<T>(
  account: ImapAccount,
  password: string,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = createImapClient(account, password);
  // imapflow emits "error" on socket problems; without a listener Deno would crash the worker.
  client.on("error", (err: unknown) => console.error("IMAP", err));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

/** Turns technical IMAP/SMTP errors into short German hints. */
export function friendlyMailError(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  const text = `${e?.responseText ?? ""} ${e?.message ?? ""}`;
  if (
    e?.authenticationFailed || /AUTHENTICATIONFAILED|authentication failed|invalid credentials|LOGIN failed|EAUTH/i.test(text) ||
    e?.code === "EAUTH"
  ) {
    return "Anmeldung abgelehnt – bitte Benutzername und Passwort prüfen (T-Online: E-Mail-Passwort, iCloud: app-spezifisches Passwort, GMX/Web.de: IMAP muss in den Einstellungen erlaubt sein).";
  }
  if (e?.code === "ENOTFOUND" || /getaddrinfo|dns/i.test(text)) return "Server nicht gefunden – bitte Servernamen prüfen.";
  if (e?.code === "ECONNREFUSED") return "Verbindung abgelehnt – bitte Server und Port prüfen.";
  if (e?.code === "ETIMEDOUT" || e?.code === "ETIMEOUT" || /timeout/i.test(text)) {
    return "Zeitüberschreitung beim Verbinden – bitte später erneut versuchen.";
  }
  return truncate(text.trim() || "Unbekannter Fehler", 300);
}

export interface SpecialFolders {
  trash: string | null;
  sent: string | null;
  archive: string | null;
}

export async function detectFolders(client: ImapFlow): Promise<SpecialFolders> {
  const list = await client.list();
  const bySpecial = (flag: string) => list.find((m) => m.specialUse === flag)?.path ?? null;
  const byName = (re: RegExp) => list.find((m) => re.test(m.name) || re.test(m.path))?.path ?? null;
  return {
    trash: bySpecial("\\Trash") ??
      byName(/^(inbox[./])?(trash|papierkorb|gelöschte? (objekte|elemente|nachrichten)|deleted (items|messages))$/i),
    sent: bySpecial("\\Sent") ??
      byName(/^(inbox[./])?(sent|gesendet|gesendete? (objekte|elemente|nachrichten)|sent (items|messages))$/i),
    archive: bySpecial("\\Archive") ?? byName(/^(inbox[./])?(archive|archiv)$/i),
  };
}

export interface ParsedMail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  fromName: string | null;
  fromEmail: string | null;
  to: string;
  cc: string;
  replyTo: string | null;
  subject: string;
  sentAt: string | null;
  seen: boolean;
  answered: boolean;
  bodyText: string;
  snippet: string;
  attachmentNames: string[];
  isBulk: boolean;
  listUnsubscribe: string | null;
  unsubscribeOneClick: boolean;
}

interface Address {
  name?: string;
  address?: string;
  group?: Address[];
}

function flattenAddresses(list?: Address[] | Address | null): Address[] {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.flatMap((a) => (a.group ? flattenAddresses(a.group) : [a]));
}

function formatAddresses(list?: Address[] | Address | null): string {
  return flattenAddresses(list)
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : a.address ?? ""))
    .filter(Boolean)
    .join(", ");
}

const HEADER_FIELDS = [
  "list-unsubscribe",
  "list-unsubscribe-post",
  "list-id",
  "precedence",
  "x-campaign",
  "x-campaign-id",
  "x-mailchimp-id",
  "x-mc-user",
  "x-sfmc-stack",
  "x-cleverreach",
  "x-newsletter",
  "x-rpcampaign",
  "x-mailgun-tag",
  "x-sg-eid",
  "feedback-id",
];

const MAX_SOURCE_BYTES = 60_000;
const MAX_BODY_CHARS = 20_000;

export async function parseMessage(
  uid: number,
  source: Uint8Array,
  flags: Set<string>,
  headerBlock: string,
  internalDate?: Date,
): Promise<ParsedMail> {
  const parsed = await PostalMime.parse(source);
  const headers = parseHeaderBlock(headerBlock);
  const from = flattenAddresses(parsed.from as Address | undefined)[0];
  const text = parsed.text?.trim() ? parsed.text : htmlToText(parsed.html ?? "");
  const body = truncate(text.replace(/\r\n?/g, "\n").trim(), MAX_BODY_CHARS);
  const fromEmail = from?.address?.toLowerCase() ?? null;
  const date = parsed.date ? new Date(parsed.date) : internalDate ?? null;
  return {
    uid,
    messageId: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    references: parsed.references ?? null,
    fromName: from?.name || null,
    fromEmail,
    to: formatAddresses(parsed.to as Address[] | undefined),
    cc: formatAddresses(parsed.cc as Address[] | undefined),
    replyTo: flattenAddresses(parsed.replyTo as Address[] | undefined)[0]?.address ?? null,
    subject: parsed.subject?.trim() || "(ohne Betreff)",
    sentAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    seen: flags.has("\\Seen"),
    answered: flags.has("\\Answered"),
    bodyText: body,
    snippet: snippetOf(body),
    attachmentNames: (parsed.attachments ?? [])
      .filter((a) => a.disposition !== "inline" || !a.mimeType.startsWith("image/"))
      .map((a) => a.filename ?? a.mimeType)
      .slice(0, 20),
    isBulk: isBulkMail(headers, fromEmail),
    listUnsubscribe: headers["list-unsubscribe"] ?? null,
    unsubscribeOneClick: /one-click/i.test(headers["list-unsubscribe-post"] ?? ""),
  };
}

export interface FetchState {
  uidValidity: number | null;
  lastUid: number;
}

export interface FetchResult {
  uidValidity: number;
  lastUid: number;
  messages: ParsedMail[];
  remaining: number;
  reset: boolean;
}

/**
 * Fetches messages newer than lastUid. On the first run (or after the server reset
 * its UIDs) only the most recent messages of the last `sinceDays` days are taken.
 */
export async function fetchNewMessages(
  client: ImapFlow,
  folder: string,
  state: FetchState,
  opts: { batch: number; sinceDays: number; initialMax: number },
): Promise<FetchResult> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) throw new Error(`Ordner ${folder} nicht verfügbar`);
    const uidValidity = Number(box.uidValidity);
    const reset = state.uidValidity === null || state.uidValidity !== uidValidity;
    let lastUid = reset ? 0 : state.lastUid;

    let uids: number[] = [];
    if (box.exists > 0) {
      if (lastUid === 0) {
        const since = new Date(Date.now() - opts.sinceDays * 86_400_000);
        const found = await client.search({ since }, { uid: true });
        uids = (found || []).map(Number).sort((a, b) => a - b).slice(-opts.initialMax);
      } else {
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        uids = (found || []).map(Number).filter((u) => u > lastUid).sort((a, b) => a - b);
      }
    }

    const batch = uids.slice(0, opts.batch);
    const messages: ParsedMail[] = [];
    if (batch.length > 0) {
      for await (
        const msg of client.fetch(
          batch.join(","),
          {
            uid: true,
            flags: true,
            internalDate: true,
            headers: HEADER_FIELDS,
            source: { maxLength: MAX_SOURCE_BYTES },
          },
          { uid: true },
        )
      ) {
        if (!msg.source) continue;
        try {
          const internal = msg.internalDate ? new Date(msg.internalDate) : undefined;
          messages.push(
            await parseMessage(Number(msg.uid), msg.source, msg.flags ?? new Set(), msg.headers?.toString() ?? "", internal),
          );
        } catch (err) {
          console.error("Mail nicht lesbar", msg.uid, err);
        }
      }
      lastUid = Math.max(lastUid, ...batch);
    } else if (reset && uids.length === 0 && box.uidNext) {
      // Empty window: start after the current highest UID so old mail is never imported.
      lastUid = Math.max(0, Number(box.uidNext) - 1);
    }

    return { uidValidity, lastUid, messages, remaining: uids.length - batch.length, reset };
  } finally {
    lock.release();
  }
}

/** Returns the flags of the given UIDs; UIDs missing from the result no longer exist. */
export async function fetchFlags(client: ImapFlow, folder: string, uids: number[]): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  if (uids.length === 0) return out;
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    for await (const msg of client.fetch(uids.join(","), { uid: true, flags: true }, { uid: true })) {
      out.set(Number(msg.uid), msg.flags ?? new Set());
    }
  } finally {
    lock.release();
  }
  return out;
}

export async function moveMessages(client: ImapFlow, folder: string, uids: number[], target: string): Promise<void> {
  if (uids.length === 0) return;
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageMove(uids.join(","), target, { uid: true });
  } finally {
    lock.release();
  }
}

export async function changeFlags(
  client: ImapFlow,
  folder: string,
  uids: number[],
  flags: string[],
  add: boolean,
): Promise<void> {
  if (uids.length === 0) return;
  const lock = await client.getMailboxLock(folder);
  try {
    if (add) await client.messageFlagsAdd(uids.join(","), flags, { uid: true });
    else await client.messageFlagsRemove(uids.join(","), flags, { uid: true });
  } finally {
    lock.release();
  }
}

export async function appendMessage(client: ImapFlow, folder: string, raw: Uint8Array, flags: string[]): Promise<void> {
  await client.append(folder, Buffer.from(raw), flags);
}
