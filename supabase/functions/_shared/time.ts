// Zeitzonen-Hilfen. Edge Functions laufen in UTC, die Nutzerin lebt in Europe/Berlin.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS[get("weekday")] ?? 1,
  };
}

/** Offset of the zone to UTC in minutes at the given instant (Berlin summer: +120). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - whole) / 60000);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Converts a wall-clock time ("2026-10-06T10:00" or "2026-10-06") in the given zone
 * to an absolute Date. Strings with an explicit offset or "Z" are parsed as-is.
 */
export function zonedToUtc(local: string, tz: string): Date {
  const trimmed = local.trim();
  const m = LOCAL_RE.exec(trimmed);
  if (!m) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new Error(`Ungültiges Datum: ${local}`);
    return parsed;
  }
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // Offsets a day before/after cover both sides of a DST switch. For the ambiguous
  // hour in autumn the earlier instant (summer time) wins, as in most libraries.
  const offsets = [
    ...new Set([
      tzOffsetMinutes(new Date(guess - 86_400_000), tz),
      tzOffsetMinutes(new Date(guess + 86_400_000), tz),
    ]),
  ];
  const candidates = offsets
    .map((offset) => guess - offset * 60000)
    .filter((utc) => guess - tzOffsetMinutes(new Date(utc), tz) * 60000 === utc)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]);
  // Wall-clock time inside the spring gap: move forward like a clock would.
  return new Date(guess - Math.min(...offsets) * 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the instant in the given zone. */
export function localDate(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:MM" of the instant in the given zone. */
export function localDateTime(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const germanFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Dienstag, 6. Oktober 2026, 10:00" */
export function formatGerman(date: Date, tz: string, withTime = true): string {
  const key = `${tz}|${withTime}`;
  let f = germanFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("de-DE", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
    germanFormatters.set(key, f);
  }
  return f.format(date);
}
