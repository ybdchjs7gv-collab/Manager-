// Demo-Modus: alle Daten liegen nur im Browser. Zeigt die App mit Beispieldaten
// und simuliert die Server-Funktionen (E-Mail-Abruf, KI, Kalender).
import type { Backend, Cond, Query } from "./db";
import { addDaysStr, atMinutes, isoWeekday, startOfWeekStr, todayStr } from "./dates";
import { parseQuickText } from "./quickparse";
import type { Settings, TableName, TableTypes } from "./types";

const STORE_KEY = "manager.demo.data.v1";
export const DEMO_USER = "00000000-0000-4000-8000-000000000001";

type Store = { [K in TableName]: TableTypes[K][] } & { settings: Settings };

const DEFAULTS: { [K in TableName]?: Partial<TableTypes[K]> } = {
  events: {
    description: null, location: null, all_day: false, area: "privat", kind: "termin", source: "manual", source_ref: null,
    ref_table: null, ref_id: null, status: "confirmed", reminder_minutes: null, cal_connection_id: null, cal_href: null,
    ext_uid: null, ext_href: null, ext_instance: "", ext_etag: null, sync_state: "local", sync_error: null,
  },
  tasks: { notes: null, area: "privat", priority: 2, duration_min: 30, due_date: null, status: "offen", event_id: null, source: "manual", source_ref: null, completed_at: null },
  chores: { room: null, duration_min: 20, interval_days: 7, preferred_weekdays: [], preferred_time: "egal", last_done_at: null, active: true },
  workouts: { sport: "sonstiges", duration_min: 45, weekdays: [], preferred_time: "egal", intensity: null, notes: null, active: true },
  workout_logs: { workout_id: null, duration_min: null, done: true, notes: null },
  recipes: { ingredients: [], prep_min: 30, servings: 2, instructions: null, tags: [], source: "manual" },
  meal_plan: { meal: "abend", recipe_id: null, prep_min: null, notes: null },
  shopping_items: { quantity: null, category: "Sonstiges", checked: false, source: "manual", recipe_id: null, checked_at: null },
  chats: { area: "privat", participants: [], message_count: 0, last_message_at: null, last_import_at: null, summary: null, key_points: [], open_questions: [], todos: [], events: [], reply_suggestion: null, summarized_until: null },
};

function uuid(): string {
  return crypto.randomUUID();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function matches(row: Record<string, unknown>, where: Cond[] = []): boolean {
  return where.every(([col, op, value]) => {
    const v = row[col];
    switch (op) {
      case "eq":
        return v === value;
      case "neq":
        return v !== value;
      case "gt":
        return v !== null && v !== undefined && (v as string) > (value as string);
      case "gte":
        return v !== null && v !== undefined && (v as string) >= (value as string);
      case "lt":
        return v !== null && v !== undefined && (v as string) < (value as string);
      case "lte":
        return v !== null && v !== undefined && (v as string) <= (value as string);
      case "in":
        return (value as unknown[]).includes(v);
      case "notIn":
        return !(value as unknown[]).includes(v);
      case "is":
        return v === value || (value === null && v === undefined);
    }
  });
}

export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  private store: Store;
  private listeners = new Set<(table: TableName) => void>();

  constructor() {
    let loaded: Store | null = null;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      loaded = raw ? (JSON.parse(raw) as Store) : null;
    } catch {
      loaded = null;
    }
    this.store = loaded ?? seed();
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.store));
    } catch {
      // storage full or blocked – keep working in memory
    }
  }

  private changed(table: TableName) {
    this.persist();
    for (const fn of this.listeners) fn(table);
  }

  private rows<K extends TableName>(table: K): TableTypes[K][] {
    return this.store[table] as TableTypes[K][];
  }

  async list<K extends TableName>(table: K, q: Query = {}): Promise<TableTypes[K][]> {
    let rows = this.rows(table).filter((r) => matches(r as unknown as Record<string, unknown>, q.where));
    for (const [col, dir] of [...(q.order ?? [])].reverse()) {
      rows = [...rows].sort((a, b) => {
        const c = compare((a as unknown as Record<string, unknown>)[col], (b as unknown as Record<string, unknown>)[col]);
        return dir === "asc" ? c : -c;
      });
    }
    if (q.limit) rows = rows.slice(0, q.limit);
    return clone(rows);
  }

  async count(table: TableName, where: Cond[] = []): Promise<number> {
    return this.rows(table).filter((r) => matches(r as unknown as Record<string, unknown>, where)).length;
  }

  async insert<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[]): Promise<TableTypes[K][]> {
    const now = new Date().toISOString();
    const created = rows.map((r) => ({
      id: table === "chat_messages" ? Date.now() + Math.random() : uuid(),
      user_id: DEMO_USER,
      created_at: now,
      updated_at: now,
      ...(DEFAULTS[table] ?? {}),
      ...r,
    })) as unknown as TableTypes[K][];
    this.rows(table).push(...created);
    this.changed(table);
    return clone(created);
  }

  async insertIgnoreDuplicates<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[], onConflict: string): Promise<void> {
    const cols = onConflict.split(",").map((c) => c.trim());
    const key = (r: Record<string, unknown>) => cols.map((c) => String(r[c])).join("|");
    const existing = new Set(this.rows(table).map((r) => key(r as unknown as Record<string, unknown>)));
    const fresh = rows.filter((r) => {
      const k = key(r as Record<string, unknown>);
      if (existing.has(k)) return false;
      existing.add(k);
      return true;
    });
    if (fresh.length > 0) await this.insert(table, fresh);
  }

  async update<K extends TableName>(table: K, where: Cond[], patch: Partial<TableTypes[K]>): Promise<TableTypes[K][]> {
    const updated: TableTypes[K][] = [];
    const now = new Date().toISOString();
    for (const row of this.rows(table)) {
      if (matches(row as unknown as Record<string, unknown>, where)) {
        Object.assign(row as object, patch, "updated_at" in (row as object) ? { updated_at: now } : {});
        updated.push(row);
      }
    }
    this.changed(table);
    return clone(updated);
  }

  async remove(table: TableName, where: Cond[]): Promise<void> {
    const keep = this.rows(table).filter((r) => !matches(r as unknown as Record<string, unknown>, where));
    (this.store as unknown as Record<string, unknown[]>)[table] = keep;
    this.changed(table);
  }

  async getSettings(): Promise<Settings> {
    return clone(this.store.settings);
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    this.store.settings = { ...this.store.settings, ...patch };
    this.persist();
    return clone(this.store.settings);
  }

  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    switch (name) {
      case "owner_exists":
        return true as T;
      case "has_secret":
        return (args.p_kind === "ai") as T;
      default:
        return null as T;
    }
  }

  async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    await new Promise((r) => setTimeout(r, 450));
    return (await demoFunction(this, fn, body)) as T;
  }

  subscribe(onChange: (table: TableName) => void): () => void {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  reset() {
    this.store = seed();
    this.persist();
  }
}

export function resetDemo() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Simulierte Server-Funktionen
// ---------------------------------------------------------------------------

const unavailable = () => {
  throw new Error("Im Demo-Modus nicht verfügbar – dafür wird die echte App mit Server benötigt.");
};

async function demoFunction(demo: DemoBackend, fn: string, body: Record<string, unknown>): Promise<unknown> {
  const action = String(body.action ?? "");
  if (fn === "mail-sync") {
    await demo.update("emails", [["ai_status", "eq", "pending"]], { ai_status: "done" });
    return { ok: true, accounts: [{ account: "T-Online", fetched: 0, remaining: 0 }, { account: "GMX", fetched: 0, remaining: 0 }] };
  }
  if (fn === "calendar-sync") {
    if (action === "discover" || action === "save") unavailable();
    return { ok: true, push: { pushed: 0, deleted: 0, failed: 0 }, pulls: [] };
  }
  if (fn === "mail-action") {
    const ids = (body.email_ids as string[] | undefined) ?? [];
    switch (action) {
      case "delete":
        await demo.update("emails", [["id", "in", ids]], { status: "geloescht", deleted_on_server: true });
        return { ok: true, deleted: ids.length, errors: [] };
      case "mark":
        await demo.update("emails", [["id", "in", ids]], { is_read: Boolean(body.read) });
        return { ok: true, errors: [] };
      case "send":
        if (body.reply_to_email_id) {
          await demo.update("emails", [["id", "eq", String(body.reply_to_email_id)]], { status: "erledigt", is_answered: true, needs_reply: false });
        }
        return { ok: true, warnings: ["Demo: Die Nachricht wurde nicht wirklich verschickt."] };
      case "unsubscribe":
        return { ok: true, done: true };
      default:
        return unavailable();
    }
  }
  if (fn === "ai") return demoAi(demo, action, body);
  if (fn === "register") return unavailable();
  throw new Error(`Unbekannte Funktion ${fn}`);
}

async function demoAi(demo: DemoBackend, action: string, body: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case "status":
      return { configured: true, source: "demo", cost_month_usd: 0.42, cost_24h_usd: 0.03, models: [] };
    case "set_key":
      return { ok: true };
    case "draft_reply": {
      const [email] = await demo.list("emails", { where: [["id", "eq", String(body.email_id)]] });
      const name = email?.from_name?.split(" ")[0] ?? "";
      const formal = email?.area === "beruflich";
      const greeting = formal ? `Guten Tag${email?.from_name ? ` ${email.from_name}` : ""},` : `Hallo ${name},`;
      const text = formal
        ? `${greeting}\n\nvielen Dank für Ihre Nachricht. Donnerstag um 10:00 Uhr passt mir gut – ich bin dabei und bereite die Zahlen bis dahin vor.\n\nViele Grüße`
        : `${greeting}\n\nwie schön, danke dir! Sonntag passt super, ich bringe einen Nachtisch mit. Um wie viel Uhr soll ich da sein?\n\nLiebe Grüße`;
      return { ok: true, subject: `Re: ${email?.subject ?? ""}`, body: body.instruction ? `${text}\n\n(Hinweis umgesetzt: ${String(body.instruction)})` : text };
    }
    case "summarize_chat": {
      const [chat] = await demo.list("chats", { where: [["id", "eq", String(body.chat_id)]] });
      const messages = await demo.list("chat_messages", { where: [["chat_id", "eq", String(body.chat_id)]], order: [["sent_at", "asc"]] });
      const last = messages[messages.length - 1];
      const result = {
        area: chat?.area ?? "privat",
        summary: `${messages.length} Nachrichten. Zuletzt schrieb ${last?.author ?? "jemand"}: „${(last?.body ?? "").slice(0, 80)}“.`,
        key_points: messages.slice(-3).map((m) => `${m.author}: ${m.body.slice(0, 60)}`),
        open_questions: messages.filter((m) => m.body.includes("?")).slice(-2).map((m) => m.body.slice(0, 80)),
        todos: [],
        events: [],
        reply_suggestion: "Klingt gut, ich melde mich heute Abend!",
      };
      if (chat) {
        await demo.update("chats", [["id", "eq", chat.id]], {
          summary: result.summary,
          key_points: result.key_points,
          open_questions: result.open_questions,
          reply_suggestion: result.reply_suggestion,
          summarized_until: last?.sent_at ?? null,
        });
      }
      return { ok: true, ...result, events_created: 0, tasks_created: 0 };
    }
    case "quick_add":
      return { ok: true, items: parseQuickText(String(body.text ?? "")) };
    case "plan_meals": {
      const days = (body.days as { date: string }[]) ?? [];
      const ideas = DEMO_RECIPES;
      return {
        ok: true,
        meals: days.map((d, i) => {
          const r = ideas[i % ideas.length];
          return { day: d.date, meal: "abend", name: r.name, prep_min: r.prep_min, servings: Number(body.persons ?? 2), ingredients: r.ingredients, instructions: r.instructions };
        }),
        tips: "Demo-Vorschlag: Das Curry lässt sich gut für zwei Tage vorkochen.",
      };
    }
    case "plan_workouts": {
      const perWeek = Math.min(Number(body.per_week ?? 3), 5);
      const base = [
        { title: "Lockerer Lauf", sport: "laufen", weekdays: [1], intensity: "locker", notes: "Im Gesprächstempo laufen, 5 Min. einlaufen." },
        { title: "Kraft Ganzkörper", sport: "kraft", weekdays: [3], intensity: "mittel", notes: "Kniebeugen, Liegestütze, Rudern – je 3 Sätze." },
        { title: "Yoga & Mobility", sport: "yoga", weekdays: [5], intensity: "locker", notes: "Fokus auf Hüfte und Rücken." },
        { title: "Intervall-Lauf", sport: "laufen", weekdays: [6], intensity: "intensiv", notes: "6 × 2 Min. zügig, 2 Min. Gehpause." },
        { title: "Radtour", sport: "rad", weekdays: [7], intensity: "locker", notes: "Gemütlich, Hauptsache draußen." },
      ];
      return {
        ok: true,
        workouts: base.slice(0, perWeek).map((w) => ({ ...w, duration_min: Number(body.minutes ?? 45), preferred_time: String(body.preferred_time ?? "abends") })),
        advice: "Demo-Plan: Zwischen intensiven Einheiten liegt immer ein Ruhetag.",
      };
    }
    case "day_briefing":
      return {
        ok: true,
        briefing: "Heute ist gut gefüllt: vormittags Fokuszeit für die Präsentation, nachmittags Termine und abends Sport und Kochen.",
        tips: ["Beantworte die zwei wichtigen Mails direkt nach dem ersten Termin.", "Erledige den Einkauf auf dem Heimweg – das spart eine extra Fahrt."],
        warnings: [],
      };
    default:
      return unavailable();
  }
}

// ---------------------------------------------------------------------------
// Beispieldaten
// ---------------------------------------------------------------------------

const DEMO_RECIPES = [
  {
    name: "Gemüse-Curry mit Kichererbsen",
    prep_min: 35,
    instructions: "Zwiebel und Knoblauch anbraten\nCurrypaste kurz mitrösten\nGemüse, Kichererbsen und Kokosmilch zugeben\n15 Min. köcheln, mit Reis servieren",
    ingredients: [
      { name: "Kichererbsen", amount: "1", unit: "Dose", category: "Vorrat & Konserven" },
      { name: "Kokosmilch", amount: "400", unit: "ml", category: "Vorrat & Konserven" },
      { name: "Paprika", amount: "2", unit: "Stk", category: "Obst & Gemüse" },
      { name: "Basmatireis", amount: "200", unit: "g", category: "Vorrat & Konserven" },
    ],
  },
  {
    name: "Ofengemüse mit Feta",
    prep_min: 40,
    instructions: "Ofen auf 200 °C vorheizen\nGemüse schneiden und mit Öl mischen\n25 Min. backen\nFeta darüberbröseln",
    ingredients: [
      { name: "Süßkartoffel", amount: "2", unit: "Stk", category: "Obst & Gemüse" },
      { name: "Zucchini", amount: "1", unit: "Stk", category: "Obst & Gemüse" },
      { name: "Feta", amount: "200", unit: "g", category: "Milch & Kühlregal" },
    ],
  },
  {
    name: "Pasta mit Tomaten-Basilikum-Soße",
    prep_min: 20,
    instructions: "Nudeln kochen\nTomaten mit Knoblauch einkochen\nBasilikum unterheben",
    ingredients: [
      { name: "Spaghetti", amount: "250", unit: "g", category: "Vorrat & Konserven" },
      { name: "Kirschtomaten", amount: "400", unit: "g", category: "Obst & Gemüse" },
      { name: "Basilikum", amount: "1", unit: "Bund", category: "Obst & Gemüse" },
    ],
  },
];

function iso(date: string, minutes: number): string {
  return atMinutes(date, minutes).toISOString();
}

function seed(): Store {
  const today = todayStr();
  const now = new Date().toISOString();
  const base = { user_id: DEMO_USER, created_at: now, updated_at: now };
  const d = (n: number) => addDaysStr(today, n);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const wd = isoWeekday(today);

  const accounts: TableTypes["mail_accounts"][] = [
    { ...base, id: "acc-tonline", label: "T-Online", email: "vorname.nachname@t-online.de", area: "privat", provider: "tonline", imap_host: "secureimap.t-online.de", imap_port: 993, imap_secure: true, smtp_host: "securesmtp.t-online.de", smtp_port: 465, smtp_secure: true, username: "vorname.nachname@t-online.de", folder: "INBOX", trash_folder: "Trash", sent_folder: "Sent", last_uid: 120, last_sync_at: hoursAgo(0.1), last_error: null, enabled: true },
    { ...base, id: "acc-gmx", label: "GMX (Arbeit)", email: "buero@gmx.de", area: "beruflich", provider: "gmx", imap_host: "imap.gmx.net", imap_port: 993, imap_secure: true, smtp_host: "mail.gmx.net", smtp_port: 465, smtp_secure: true, username: "buero@gmx.de", folder: "INBOX", trash_folder: "Papierkorb", sent_folder: "Gesendet", last_uid: 88, last_sync_at: hoursAgo(0.1), last_error: null, enabled: true },
  ];

  const mail = (e: Partial<TableTypes["emails"]>): TableTypes["emails"] => ({
    ...base, id: uuid(), account_id: "acc-tonline", folder: "INBOX", uid: Math.floor(Math.random() * 1e6), message_id: null,
    from_name: null, from_email: null, to_list: null, cc_list: null, reply_to: null, subject: null, sent_at: hoursAgo(2), snippet: null,
    body_text: null, has_attachments: false, attachment_names: [], is_read: false, is_answered: false, is_bulk: false, list_unsubscribe: null,
    unsubscribe_one_click: false, area: "privat", category: "info", priority: 1, needs_reply: false, ai_summary: null, ai_action: null,
    ai_events: [], ai_tasks: [], ai_status: "done", ai_error: null, status: "neu", deleted_on_server: false, ...e,
  });

  const emails = [
    mail({ from_name: "Mama", from_email: "mama@t-online.de", subject: "Sonntag Mittagessen?", sent_at: hoursAgo(1.5), category: "persoenlich", priority: 2, needs_reply: true,
      body_text: "Hallo mein Schatz,\n\nhast du am Sonntag Zeit zum Mittagessen? Papa macht seinen Braten, so gegen 12:30 Uhr.\n\nGib Bescheid!\nMama",
      ai_summary: "Mama lädt dich am Sonntag um 12:30 Uhr zum Mittagessen ein und wartet auf eine Antwort.", ai_action: "Zu- oder absagen",
      ai_events: [{ title: "Mittagessen bei Mama & Papa", start: `${d((7 - wd) || 7)}T12:30`, end: `${d((7 - wd) || 7)}T14:30`, all_day: false, location: null, confidence: "mittel" }] }),
    mail({ account_id: "acc-gmx", area: "beruflich", from_name: "Jonas Weber", from_email: "j.weber@firma.example", subject: "Projektmeeting Donnerstag 10 Uhr", sent_at: hoursAgo(3), category: "termin", priority: 2, needs_reply: true,
      body_text: "Hallo zusammen,\n\nwir treffen uns am Donnerstag um 10:00 Uhr im Besprechungsraum 2 zum Projekt-Update. Bitte bringt die aktuellen Zahlen mit.\n\nBeste Grüße\nJonas",
      ai_summary: "Projekt-Update am Donnerstag um 10 Uhr im Raum 2; aktuelle Zahlen mitbringen.", ai_action: "Zahlen vorbereiten und zusagen",
      ai_tasks: [{ title: "Zahlen für Projekt-Update vorbereiten", due_date: d(((4 - wd + 7) % 7) || 7), duration_min: 45 }] }),
    mail({ from_name: "Stadtwerke", from_email: "rechnung@stadtwerke.example", subject: "Ihre Abschlagsrechnung Oktober", sent_at: hoursAgo(20), category: "rechnung", priority: 2, is_read: true, status: "gelesen",
      body_text: "Sehr geehrte Kundin, sehr geehrter Kunde,\n\nIhre Abschlagszahlung über 86,00 € wird am 15. des Monats per Lastschrift eingezogen.",
      ai_summary: "Abschlag über 86 € wird am 15. automatisch abgebucht – nichts zu tun.", ai_action: "" }),
    mail({ from_name: "Zalando", from_email: "news@zalando.example", subject: "Nur heute: 20 % auf Herbstmode", sent_at: hoursAgo(5), category: "werbung", priority: 0, is_bulk: true, list_unsubscribe: "<https://zalando.example/unsub>", unsubscribe_one_click: true,
      body_text: "Entdecke die neuen Herbst-Styles …", ai_summary: "Werbung für eine Rabattaktion." }),
    mail({ account_id: "acc-gmx", area: "beruflich", from_name: "t3n Newsletter", from_email: "newsletter@t3n.example", subject: "Die Woche in Tech", sent_at: hoursAgo(9), category: "newsletter", priority: 0, is_bulk: true, list_unsubscribe: "<https://t3n.example/unsub>",
      body_text: "Die wichtigsten Tech-News der Woche …", ai_summary: "Wöchentlicher Tech-Newsletter." }),
    mail({ from_name: "DHL", from_email: "noreply@dhl.example", subject: "Ihre Sendung kommt morgen", sent_at: hoursAgo(26), category: "bestellung", priority: 1, is_read: true, status: "gelesen",
      body_text: "Ihre Sendung 00340434 wird morgen zwischen 10 und 14 Uhr zugestellt.", ai_summary: "Paket kommt morgen zwischen 10 und 14 Uhr." }),
  ];

  const ev = (e: Partial<TableTypes["events"]>): TableTypes["events"] => ({
    ...base, id: uuid(), title: "", description: null, location: null, start_at: now, end_at: now, all_day: false, area: "privat", kind: "termin",
    source: "manual", source_ref: null, ref_table: null, ref_id: null, status: "confirmed", reminder_minutes: 30, cal_connection_id: null,
    cal_href: null, ext_uid: null, ext_href: null, ext_instance: "", ext_etag: null, sync_state: "local", sync_error: null, ...e,
  });

  const events = [
    ev({ title: "Team-Standup", area: "beruflich", start_at: iso(today, 9 * 60 + 30), end_at: iso(today, 9 * 60 + 45) }),
    ev({ title: "Kundentermin Müller GmbH", area: "beruflich", location: "Online (Teams)", start_at: iso(today, 14 * 60), end_at: iso(today, 15 * 60) }),
    ev({ title: "Zahnarzt Dr. Schulz", location: "Hauptstraße 12", start_at: iso(d(1), 8 * 60), end_at: iso(d(1), 8 * 60 + 45) }),
    ev({ title: "Geburtstag Anna", all_day: true, start_at: atMinutes(d(3), 0).toISOString(), end_at: atMinutes(d(4), 0).toISOString(), source: "caldav", sync_state: "readonly" }),
  ];

  const task = (t: Partial<TableTypes["tasks"]>): TableTypes["tasks"] => ({
    ...base, id: uuid(), title: "", notes: null, area: "privat", priority: 2, duration_min: 30, due_date: null, status: "offen", event_id: null,
    source: "manual", source_ref: null, completed_at: null, ...t,
  });

  const tasks = [
    task({ title: "Präsentation Quartalszahlen vorbereiten", area: "beruflich", priority: 3, duration_min: 120, due_date: d(2) }),
    task({ title: "Angebot für Müller GmbH schreiben", area: "beruflich", priority: 2, duration_min: 60, due_date: d(4) }),
    task({ title: "Steuerunterlagen sortieren", priority: 2, duration_min: 90, due_date: d(6) }),
    task({ title: "Geschenk für Anna besorgen", priority: 3, duration_min: 30, due_date: d(2) }),
    task({ title: "Kfz-Versicherung vergleichen", priority: 1, duration_min: 45 }),
  ];

  const chore = (c: Partial<TableTypes["chores"]>): TableTypes["chores"] => ({
    ...base, id: uuid(), title: "", room: null, duration_min: 20, interval_days: 7, preferred_weekdays: [], preferred_time: "abends",
    last_done_at: null, next_due: today, active: true, ...c,
  });

  const chores = [
    chore({ title: "Staubsaugen", room: "Wohnung", duration_min: 30, interval_days: 7, next_due: today }),
    chore({ title: "Bad putzen", room: "Bad", duration_min: 40, interval_days: 7, next_due: d(2) }),
    chore({ title: "Wäsche waschen", room: "Keller", duration_min: 20, interval_days: 4, next_due: d(-1) }),
    chore({ title: "Müll rausbringen", room: "Küche", duration_min: 10, interval_days: 3, next_due: today }),
    chore({ title: "Bettwäsche wechseln", room: "Schlafzimmer", duration_min: 20, interval_days: 14, next_due: d(5) }),
    chore({ title: "Pflanzen gießen", room: "Wohnung", duration_min: 10, interval_days: 3, next_due: d(1), preferred_time: "morgens" }),
  ];

  const workouts: TableTypes["workouts"][] = [
    { ...base, id: "wo-run", title: "Laufen", sport: "laufen", duration_min: 40, weekdays: [1, 3, 5], preferred_time: "morgens", intensity: "locker", notes: "5 km im Wohlfühltempo", active: true },
    { ...base, id: "wo-kraft", title: "Krafttraining", sport: "kraft", duration_min: 45, weekdays: [2, 4], preferred_time: "abends", intensity: "mittel", notes: "Ganzkörper", active: true },
    { ...base, id: "wo-yoga", title: "Yoga", sport: "yoga", duration_min: 30, weekdays: [7], preferred_time: "egal", intensity: "locker", notes: null, active: true },
  ];

  const recipes: TableTypes["recipes"][] = DEMO_RECIPES.map((r, i) => ({
    ...base, id: `rec-${i}`, name: r.name, ingredients: r.ingredients, prep_min: r.prep_min, servings: 2, instructions: r.instructions, tags: [], source: "demo",
  }));

  const monday = startOfWeekStr(today);
  const meal_plan: TableTypes["meal_plan"][] = [0, 1, 2, 3, 4].map((i) => ({
    ...base, id: uuid(), day: addDaysStr(monday, i), meal: "abend", recipe_id: recipes[i % recipes.length].id, title: recipes[i % recipes.length].name,
    prep_min: recipes[i % recipes.length].prep_min, notes: null,
  }));

  const shop = (name: string, category: string, quantity: string | null = null): TableTypes["shopping_items"] => ({
    ...base, id: uuid(), name, quantity, category, checked: false, source: "manual", recipe_id: null, checked_at: null,
  });
  const shopping_items = [
    shop("Hafermilch", "Milch & Kühlregal", "2 l"),
    shop("Bananen", "Obst & Gemüse", "6"),
    shop("Vollkornbrot", "Brot & Backwaren"),
    shop("Kokosmilch", "Vorrat & Konserven", "400 ml"),
    shop("Spülmittel", "Haushalt"),
  ];

  const chatId = uuid();
  const chats: TableTypes["chats"][] = [{
    ...base, id: chatId, name: "Familie", area: "privat", participants: ["Papa", "Lena", "Du"], message_count: 4, last_message_at: hoursAgo(4),
    last_import_at: hoursAgo(3), summary: "Die Familie plant Papas 60. Geburtstag am 18. Oktober. Lena kümmert sich um das Restaurant, du sollst die Einladungen verschicken.",
    key_points: ["Feier am 18.10. ab 18 Uhr", "Lena reserviert das Restaurant", "Einladungen bis Freitag verschicken"],
    open_questions: ["Lena fragt, ob du die Gästeliste hast"],
    todos: [{ title: "Einladungen für Papas Geburtstag verschicken", due_date: d(4), duration_min: 30 }],
    events: [], reply_suggestion: "Ja, die Gästeliste schicke ich euch heute Abend!", summarized_until: hoursAgo(4), created_at: now,
  }];
  const chat_messages: TableTypes["chat_messages"][] = [
    ["Lena", "Wir müssen Papas 60. planen! 18.10. passt allen?", 6],
    ["Papa", "Ich will gar keine große Feier 😅", 5.5],
    ["Lena", "Keine Chance. Ich reserviere das Restaurant, kannst du die Einladungen machen?", 5],
    ["Lena", "Hast du eigentlich die Gästeliste noch?", 4],
  ].map(([author, body, h], i) => ({ id: i + 1, user_id: DEMO_USER, chat_id: chatId, sent_at: hoursAgo(h as number), author: author as string, body: body as string, hash: `demo-${i}` }));

  const settings: Settings = {
    user_id: DEMO_USER,
    display_name: "Demo",
    timezone: "Europe/Berlin",
    day_start: "07:00",
    day_end: "22:00",
    work_days: [1, 2, 3, 4, 5],
    work_start: "08:30",
    work_end: "17:00",
    lunch_start: "12:30",
    lunch_minutes: 45,
    dinner_time: "18:30",
    buffer_minutes: 10,
    max_block_minutes: 90,
    preferences: { workout_time: "abends", chore_time: "abends", shopping_minutes: 45, shopping_min_items: 5, persons: 2 },
    auto_delete_newsletters: false,
    auto_add_events: true,
    auto_create_tasks: true,
    ai_model: "claude-opus-5-5",
    ai_model_bulk: "claude-opus-5-5",
    ics_token: "demo",
  };

  return {
    events, tasks, chores, workouts, workout_logs: [], recipes, meal_plan, shopping_items, mail_accounts: accounts, emails, chats,
    chat_messages, calendar_connections: [], settings,
  };
}
