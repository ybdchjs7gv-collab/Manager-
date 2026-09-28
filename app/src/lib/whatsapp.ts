// Liest exportierte WhatsApp-Chats (iPhone und Android, mit oder ohne ZIP).
import { unzipSync } from "fflate";

export interface ChatMessage {
  sentAt: Date;
  author: string;
  text: string;
}

export interface ParsedChat {
  name: string | null;
  messages: ChatMessage[];
  participants: string[];
}

const LRM = /[‎‏‪-‮⁦-⁩]/g;

// [28.09.26, 14:03:12] Name: Text        (iPhone)
const IOS_RE = /^\[(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s?([AaPp]\.?\s?[Mm]\.?)?\]\s+([^:]{1,80}?):\s?(.*)$/;
// 28.09.26, 14:03 - Name: Text           (Android)
const ANDROID_RE = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s?([AaPp]\.?\s?[Mm]\.?)?\s+[-–]\s+(?:([^:]{1,80}?):\s?)?(.*)$/;

const SYSTEM_TEXTS = [
  /Ende-zu-Ende-verschlüsselt/i,
  /end-to-end encrypted/i,
  /^.{1,80} hat (die Gruppe|diese Gruppe) .{0,80}(erstellt|geändert)\.?$/i,
  /^.{1,80} hat .{1,80} (hinzugefügt|entfernt)\.?$/i,
  /^.{1,80} (ist beigetreten|hat die Gruppe verlassen)\.?$/i,
  /Sicherheitsnummer .* hat sich geändert/i,
  /security code .* changed/i,
  /selbstlöschende Nachrichten|Nachrichten, die verschwinden/i,
];

const MEDIA: [RegExp, string][] = [
  [/^<?(Medien ausgeschlossen|Media omitted)>?$/i, "[Medien]"],
  [/^(Bild|image) (weggelassen|omitted)$/i, "[Bild]"],
  [/^(Video) (weggelassen|omitted)$/i, "[Video]"],
  [/^(Audio) (weggelassen|omitted)$/i, "[Sprachnachricht]"],
  [/^(Sticker) (weggelassen|omitted)$/i, "[Sticker]"],
  [/^(GIF) (weggelassen|omitted)$/i, "[GIF]"],
  [/^(Dokument|document) (weggelassen|omitted)$/i, "[Dokument]"],
  [/^<Anhang: .+>$/i, "[Anhang]"],
  [/^<attached: .+>$/i, "[Anhang]"],
];

const DELETED = /^(Diese Nachricht wurde gelöscht\.?|Du hast diese Nachricht gelöscht\.?|This message was deleted\.?|You deleted this message\.?)$/i;

interface RawLine {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  ampm: string | undefined;
  author: string | null;
  text: string;
}

function matchLine(line: string): RawLine | null {
  const m = IOS_RE.exec(line) ?? ANDROID_RE.exec(line);
  if (!m) return null;
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let year = c;
  if (m[1].length === 4) {
    // ISO-like 2026-09-28
    year = a;
    a = c;
  }
  if (year < 100) year += 2000;
  return {
    a,
    b,
    year,
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
    ampm: m[7],
    author: m[8] ? m[8].trim() : null,
    text: m[9] ?? "",
  };
}

export function parseChatText(input: string, fileName?: string | null): ParsedChat {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const raw: RawLine[] = [];
  for (const original of lines) {
    const line = original.replace(LRM, "");
    const m = matchLine(line);
    if (m) {
      raw.push(m);
    } else if (raw.length > 0 && line.trim() !== "") {
      raw[raw.length - 1].text += `\n${line}`;
    }
  }

  // Day-first (28.09.) or month-first (09/28)? Decide once for the whole file.
  const dayFirst = raw.some((r) => r.a > 12) || !raw.some((r) => r.b > 12);

  const messages: ChatMessage[] = [];
  for (const r of raw) {
    if (!r.author) continue;
    const body = r.text.trim();
    if (!body || DELETED.test(body) || (body.length < 300 && SYSTEM_TEXTS.some((re) => re.test(body)))) continue;
    let hour = r.hour;
    if (r.ampm) {
      const pm = /p/i.test(r.ampm);
      if (pm && hour < 12) hour += 12;
      if (!pm && hour === 12) hour = 0;
    }
    const day = dayFirst ? r.a : r.b;
    const month = dayFirst ? r.b : r.a;
    const sentAt = new Date(r.year, month - 1, day, hour, r.minute, r.second);
    if (Number.isNaN(sentAt.getTime())) continue;
    const media = MEDIA.find(([re]) => re.test(body));
    messages.push({ sentAt, author: r.author, text: media ? media[1] : body });
  }

  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
  const participants = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([name]) => name);

  return { name: chatNameFromFile(fileName), messages, participants };
}

export function chatNameFromFile(fileName?: string | null): string | null {
  if (!fileName) return null;
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const m = /WhatsApp[ -]?Chat(?:\s+(?:mit|with|-|–))?\s+(.+?)(?:\.(?:zip|txt))?$/i.exec(base);
  if (m) return m[1].trim();
  if (/^_?chat\.txt$/i.test(base)) return null;
  return base.replace(/\.(zip|txt)$/i, "").trim() || null;
}

/** Accepts the exported .zip or .txt file (or pasted text) and returns the chat. */
export async function readChatFile(file: File): Promise<ParsedChat> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const entries = unzipSync(buffer, { filter: (f) => f.name.toLowerCase().endsWith(".txt") });
    const names = Object.keys(entries);
    const chosen = names.find((n) => /_chat\.txt$/i.test(n)) ?? names[0];
    if (!chosen) throw new Error("In der ZIP-Datei wurde kein Chat gefunden.");
    text = new TextDecoder("utf-8").decode(entries[chosen]);
  } else {
    text = new TextDecoder("utf-8").decode(buffer);
  }
  const parsed = parseChatText(text, file.name);
  if (parsed.messages.length === 0) throw new Error("Die Datei enthält keine lesbaren WhatsApp-Nachrichten.");
  return parsed;
}

export async function messageHash(m: ChatMessage): Promise<string> {
  const data = new TextEncoder().encode(`${m.sentAt.toISOString()}|${m.author}|${m.text}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
