// Datums-Hilfen. Die App rechnet in der Ortszeit des Geräts (Deutschland).

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" in local time */
export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayStr(): string {
  return toDateStr(new Date());
}

export function parseDateStr(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysStr(value: string, days: number): string {
  const d = parseDateStr(value);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDateStr(a).getTime() - parseDateStr(b).getTime()) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday */
export function isoWeekday(value: Date | string): number {
  const d = typeof value === "string" ? parseDateStr(value) : value;
  return d.getDay() === 0 ? 7 : d.getDay();
}

export function startOfWeekStr(value: string): string {
  return addDaysStr(value, 1 - isoWeekday(value));
}

/** "07:30" → 450 */
export function timeToMinutes(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function minutesToTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Local Date for a day string plus minutes after midnight (DST-safe). */
export function atMinutes(dateStr: string, minutes: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
}

/** Wall-clock minutes of a Date on the given local day, clamped to [0, 1440]. */
export function minutesOnDay(date: Date, dateStr: string): number {
  const day = toDateStr(date);
  if (day < dateStr) return 0;
  if (day > dateStr) return 1440;
  return date.getHours() * 60 + date.getMinutes();
}

export function combine(dateStr: string, time: string): Date {
  return atMinutes(dateStr, timeToMinutes(time));
}

const fmtTime = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const fmtDayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const fmtDayLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("de-DE", { weekday: "short" });

export const formatTime = (d: Date | string) => fmtTime.format(new Date(d));
export const formatDayShort = (d: Date | string) => fmtDayShort.format(typeof d === "string" && d.length === 10 ? parseDateStr(d) : new Date(d));
export const formatDayLong = (d: Date | string) => fmtDayLong.format(typeof d === "string" && d.length === 10 ? parseDateStr(d) : new Date(d));
export const formatDate = (d: Date | string) => fmtDate.format(typeof d === "string" && d.length === 10 ? parseDateStr(d) : new Date(d));
export const weekdayShort = (d: Date | string) => fmtWeekday.format(typeof d === "string" && d.length === 10 ? parseDateStr(d) : new Date(d));

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "heute", "morgen", "gestern" or "Mo, 29.09." */
export function relativeDay(value: string): string {
  const diff = diffDays(value, todayStr());
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff === -1) return "gestern";
  return formatDayShort(value);
}

/** Short relative time for message lists: "14:03", "gestern", "Mo, 22.09." */
export function relativeStamp(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  const day = toDateStr(d);
  const diff = diffDays(day, todayStr());
  if (diff === 0) return formatTime(d);
  if (diff === -1) return "gestern";
  if (diff > -7) return weekdayShort(d);
  return formatDate(d).slice(0, 6);
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} Std.` : `${h} Std. ${m} Min.`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 17) return "Hallo";
  return "Guten Abend";
}
