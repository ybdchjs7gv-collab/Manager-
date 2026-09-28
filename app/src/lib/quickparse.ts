// Einfache Erkennung von Termin, Aufgabe oder Einkauf in einer Notiz – funktioniert
// ohne KI (z. B. "Zahnarzt Dienstag 10 Uhr", "Milch und Brot kaufen", "Steuer bis Freitag").
import { addDaysStr, isoWeekday, todayStr } from "./dates";
import { guessCategory, splitItems } from "./shopping";
import type { Area } from "./types";

export interface QuickItem {
  type: "event" | "task" | "shopping" | "chore";
  title: string;
  area: Area;
  start: string | null;
  end: string | null;
  all_day: boolean;
  location: string | null;
  duration_min: number | null;
  priority: number | null;
  due_date: string | null;
  quantity: string | null;
  category: string | null;
  interval_days: number | null;
}

const WEEKDAYS: Record<string, number> = {
  montag: 1, mo: 1, dienstag: 2, di: 2, mittwoch: 3, mi: 3, donnerstag: 4, do: 4, freitag: 5, fr: 5,
  samstag: 6, sa: 6, sonntag: 7, so: 7,
};

const WORK_RE = /\b(arbeit|büro|kunde|kundin|meeting|besprechung|projekt|chef|chefin|kollegin|kollege|präsentation|angebot|rechnung schreiben|team)\b/i;
const SHOP_RE = /^(einkauf(en)?|einkaufsliste|kaufen)\s*[:-]?\s*|\s+(kaufen|besorgen|holen)$/i;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

interface Found {
  date: string | null;
  time: string | null;
  rest: string;
}

export function findDateTime(input: string, today = todayStr()): Found {
  let text = ` ${input} `;
  let date: string | null = null;
  let time: string | null = null;

  const rel: [RegExp, number][] = [[/\s(heute)\s/i, 0], [/\s(übermorgen)\s/i, 2], [/\s(morgen)\s/i, 1]];
  for (const [re, add] of rel) {
    if (re.test(text)) {
      date = addDaysStr(today, add);
      text = text.replace(re, " ");
      break;
    }
  }

  if (!date) {
    const m = /\s(?:am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?\s/.exec(text);
    if (m) {
      const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
      let candidate = `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
      if (!m[3] && candidate < today) candidate = `${year + 1}${candidate.slice(4)}`;
      date = candidate;
      text = text.replace(m[0], " ");
    }
  }

  if (!date) {
    const m = /\s(?:(?:am|nächsten|nächste|kommenden|diesen)\s+)*(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?\s/i.exec(text);
    if (m) {
      const target = WEEKDAYS[m[1].toLowerCase()];
      let diff = (target - isoWeekday(today) + 7) % 7;
      if (diff === 0 || /nächste/i.test(m[0])) diff = diff === 0 ? 7 : diff;
      date = addDaysStr(today, diff);
      text = text.replace(m[0], " ");
    }
  }

  const t = /\s(?:um|ab|gegen)?\s*(\d{1,2})(?::(\d{2}))?\s*(uhr|h)(?=\s)/i.exec(text) ?? /\s(?:um|ab|gegen)\s+(\d{1,2}):(\d{2})\s/i.exec(text) ??
    /\s(\d{1,2}):(\d{2})\s/.exec(text);
  if (t && Number(t[1]) < 24) {
    time = `${pad(Number(t[1]))}:${pad(Number(t[2] ?? 0))}`;
    text = text.replace(t[0], " ");
  }

  return { date, time, rest: text.replace(/\s+/g, " ").trim() };
}

/** Local fallback for "Schnell erfassen" without AI. */
export function parseQuickText(input: string, today = todayStr()): QuickItem[] {
  const text = input.trim();
  if (!text) return [];
  const base: Omit<QuickItem, "type" | "title"> = {
    area: WORK_RE.test(text) ? "beruflich" : "privat",
    start: null,
    end: null,
    all_day: false,
    location: null,
    duration_min: null,
    priority: null,
    due_date: null,
    quantity: null,
    category: null,
    interval_days: null,
  };

  if (SHOP_RE.test(text)) {
    return splitItems(text.replace(SHOP_RE, "").trim()).map((item) => ({
      ...base,
      area: "privat",
      type: "shopping",
      title: item.name,
      quantity: item.quantity,
      category: item.category ?? guessCategory(item.name),
    }));
  }

  const deadline = /\s(bis|spätestens)\s/i.test(` ${text} `);
  const found = findDateTime(text.replace(/\s(bis|spätestens)(\s)/i, "$2"), today);
  const title = found.rest.replace(/^(termin|aufgabe|todo)\s*:?\s*/i, "").trim() || text;

  if (found.time && !deadline) {
    const date = found.date ?? today;
    const [h, m] = found.time.split(":").map(Number);
    const endMinutes = h * 60 + m + 60;
    return [{
      ...base,
      type: "event",
      title,
      start: `${date}T${found.time}`,
      end: `${date}T${pad(Math.floor(endMinutes / 60) % 24)}:${pad(endMinutes % 60)}`,
    }];
  }
  return [{
    ...base,
    type: "task",
    title,
    due_date: found.date,
    duration_min: 30,
    priority: /\b(dringend|wichtig|asap|sofort)\b/i.test(text) ? 3 : 2,
  }];
}
