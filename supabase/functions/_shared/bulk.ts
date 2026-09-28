// Erkennt Massen-Mails (Newsletter, Werbung) an ihren eigenen Kopfzeilen.
// Diese Merkmale kann eine fremde Mail nicht für andere Mails fälschen, deshalb
// ist das automatische Löschen immer an sie gebunden.

export interface MailHeaders {
  [name: string]: string | undefined;
}

const BULK_HEADER_NAMES = [
  "list-unsubscribe",
  "list-id",
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

const BULK_SENDER_RE = /^(newsletter|news|marketing|info|mailing|angebote?|deals|promo|noreply-?marketing)@/i;

export function isBulkMail(headers: MailHeaders, fromEmail?: string | null): boolean {
  const precedence = (headers["precedence"] ?? "").toLowerCase();
  if (["bulk", "list", "junk"].includes(precedence.trim())) return true;
  for (const name of BULK_HEADER_NAMES) {
    if (name === "feedback-id") {
      // Feedback-ID alone is also used by transactional mail; only count it with a bulk sender.
      if (headers[name] && fromEmail && BULK_SENDER_RE.test(fromEmail)) return true;
      continue;
    }
    if (headers[name]) return true;
  }
  return false;
}

/** Parses a raw header block ("Name: value\r\n …") into lower-cased names. */
export function parseHeaderBlock(block: string): MailHeaders {
  const out: MailHeaders = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    out[name] = out[name] ? `${out[name]}, ${value}` : value;
  }
  return out;
}

/** First usable unsubscribe target (https preferred, then mailto). */
export function unsubscribeTarget(listUnsubscribe?: string | null): string | null {
  if (!listUnsubscribe) return null;
  const targets = [...listUnsubscribe.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  return targets.find((t) => /^https:\/\//i.test(t)) ?? targets.find((t) => /^mailto:/i.test(t)) ?? null;
}

export const EMAIL_CATEGORIES = [
  "persoenlich",
  "arbeit",
  "termin",
  "rechnung",
  "bestellung",
  "behoerde",
  "info",
  "newsletter",
  "werbung",
  "spam",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Category when no AI is available. */
export function ruleCategory(bulk: boolean, subject: string, text: string): EmailCategory {
  if (bulk) return "newsletter";
  const s = `${subject}\n${text.slice(0, 2000)}`.toLowerCase();
  if (/\b(rechnung|zahlungserinnerung|mahnung|lastschrift|invoice|betrag fällig)\b/.test(s)) return "rechnung";
  if (/\b(termin|einladung|meeting|besprechung|kalender|verabredung)\b/.test(s)) return "termin";
  if (/\b(bestellung|versand|lieferung|sendung|paket|order)\b/.test(s)) return "bestellung";
  if (/\b(finanzamt|behörde|versicherung|krankenkasse|steuer|bescheid)\b/.test(s)) return "behoerde";
  return "info";
}
