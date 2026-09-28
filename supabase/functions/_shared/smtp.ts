// E-Mail-Versand über SMTP (Port 465 mit SSL – Port 587 ist in Supabase gesperrt).
import nodemailer from "npm:nodemailer@9.1.1";
import MailComposer from "npm:nodemailer@9.1.1/lib/mail-composer/index.js";

export interface SmtpAccount {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  username: string;
  email: string;
  label: string;
}

export interface OutgoingMail {
  fromName?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  inReplyTo?: string | null;
  references?: string | null;
}

export function canSendDirectly(account: SmtpAccount): boolean {
  return Boolean(account.smtp_host) && account.smtp_port !== 587 && account.smtp_port !== 25;
}

/** Builds the raw RFC 5322 message (also used to store a copy in "Gesendet"). */
export async function buildRawMessage(account: SmtpAccount, mail: OutgoingMail): Promise<Uint8Array> {
  const composer = new MailComposer({
    from: mail.fromName ? { name: mail.fromName, address: account.email } : account.email,
    to: mail.to,
    cc: mail.cc && mail.cc.length > 0 ? mail.cc : undefined,
    subject: mail.subject,
    text: mail.text,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references ?? mail.inReplyTo ?? undefined,
    date: new Date(),
    headers: { "X-Mailer": "Manager" },
  });
  const buffer: Uint8Array = await new Promise((resolve, reject) => {
    composer.compile().build((err: Error | null, message: Uint8Array) => (err ? reject(err) : resolve(message)));
  });
  return buffer;
}

export async function sendRaw(
  account: SmtpAccount,
  password: string,
  envelope: { from: string; to: string[] },
  raw: Uint8Array,
): Promise<void> {
  if (!canSendDirectly(account)) {
    throw new Error("Für dieses Postfach ist kein Versand über den Server möglich.");
  }
  const transport = nodemailer.createTransport({
    host: account.smtp_host!,
    port: account.smtp_port ?? 465,
    secure: account.smtp_secure,
    auth: { user: account.username, pass: password },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  try {
    await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
}

export async function verifySmtp(account: SmtpAccount, password: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: account.smtp_host!,
    port: account.smtp_port ?? 465,
    secure: account.smtp_secure,
    auth: { user: account.username, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export function splitAddresses(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(/[,;]/);
  return list.map((s) => s.trim()).filter((s) => /@/.test(s));
}

/** Pure address part of "Name <addr>" strings. */
export function bareAddress(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value).trim();
}
