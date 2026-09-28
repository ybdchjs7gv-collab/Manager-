// Datenbank-Zeilen (entsprechen supabase/migrations/*_init.sql)

export type Area = "privat" | "beruflich";
export type AreaFilter = "alle" | Area;
export type TimePref = "morgens" | "mittags" | "abends" | "egal";

export interface Preferences {
  workout_time?: TimePref;
  chore_time?: TimePref;
  shopping_minutes?: number;
  shopping_min_items?: number;
  flex_minutes_workday?: number;
  flex_minutes_freeday?: number;
  whatsapp_name?: string;
  persons?: number;
  diet?: string;
  dislikes?: string;
  setup_dismissed?: boolean;
}

export interface Settings {
  user_id: string;
  display_name: string | null;
  timezone: string;
  day_start: string;
  day_end: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  lunch_start: string | null;
  lunch_minutes: number;
  dinner_time: string | null;
  buffer_minutes: number;
  max_block_minutes: number;
  preferences: Preferences;
  auto_delete_newsletters: boolean;
  auto_add_events: boolean;
  auto_create_tasks: boolean;
  ai_model: string;
  ai_model_bulk: string;
  ics_token: string;
}

export type EventKind = "termin" | "aufgabe" | "sport" | "kochen" | "haushalt" | "einkauf" | "fokus" | "pause" | "sonstiges";
export type EventSource = "manual" | "email" | "whatsapp" | "planner" | "caldav" | "ai";
export type SyncState = "local" | "pending" | "synced" | "delete" | "error" | "readonly";

export interface CalEvent {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  area: Area;
  kind: EventKind;
  source: EventSource;
  source_ref: string | null;
  ref_table: string | null;
  ref_id: string | null;
  status: "confirmed" | "tentative" | "cancelled" | "done";
  reminder_minutes: number | null;
  cal_connection_id: string | null;
  cal_href: string | null;
  ext_uid: string | null;
  ext_href: string | null;
  ext_instance: string;
  ext_etag: string | null;
  sync_state: SyncState;
  sync_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  area: Area;
  priority: 1 | 2 | 3;
  duration_min: number;
  due_date: string | null;
  status: "offen" | "geplant" | "erledigt";
  event_id: string | null;
  source: string;
  source_ref: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Chore {
  id: string;
  user_id: string;
  title: string;
  room: string | null;
  duration_min: number;
  interval_days: number;
  preferred_weekdays: number[];
  preferred_time: TimePref;
  last_done_at: string | null;
  next_due: string;
  active: boolean;
  created_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  title: string;
  sport: string;
  duration_min: number;
  weekdays: number[];
  preferred_time: TimePref;
  intensity: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface WorkoutLog {
  id: string;
  user_id: string;
  workout_id: string | null;
  day: string;
  title: string;
  duration_min: number | null;
  done: boolean;
  notes: string | null;
  created_at: string;
}

export interface Ingredient {
  name: string;
  amount: string;
  unit: string;
  category: string;
}

export interface Recipe {
  id: string;
  user_id: string;
  name: string;
  ingredients: Ingredient[];
  prep_min: number;
  servings: number;
  instructions: string | null;
  tags: string[];
  source: string;
  created_at: string;
}

export type MealSlot = "fruehstueck" | "mittag" | "abend" | "snack";

export interface MealPlanEntry {
  id: string;
  user_id: string;
  day: string;
  meal: MealSlot;
  recipe_id: string | null;
  title: string;
  prep_min: number | null;
  notes: string | null;
  created_at: string;
}

export interface ShoppingItem {
  id: string;
  user_id: string;
  name: string;
  quantity: string | null;
  category: string;
  checked: boolean;
  source: string;
  recipe_id: string | null;
  created_at: string;
  checked_at: string | null;
}

export interface MailAccount {
  id: string;
  user_id: string;
  label: string;
  email: string;
  area: Area;
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
  last_uid: number;
  last_sync_at: string | null;
  last_error: string | null;
  enabled: boolean;
  created_at: string;
}

export type EmailCategory =
  | "persoenlich"
  | "arbeit"
  | "termin"
  | "rechnung"
  | "bestellung"
  | "behoerde"
  | "info"
  | "newsletter"
  | "werbung"
  | "spam";

export interface AiEvent {
  title: string;
  start: string;
  end: string | null;
  all_day: boolean;
  location: string | null;
  confidence: "hoch" | "mittel" | "niedrig";
}

export interface AiTask {
  title: string;
  due_date: string | null;
  duration_min: number;
}

export interface Email {
  id: string;
  user_id: string;
  account_id: string;
  folder: string;
  uid: number;
  message_id: string | null;
  from_name: string | null;
  from_email: string | null;
  to_list: string | null;
  cc_list: string | null;
  reply_to: string | null;
  subject: string | null;
  sent_at: string | null;
  snippet: string | null;
  body_text: string | null;
  has_attachments: boolean;
  attachment_names: string[];
  is_read: boolean;
  is_answered: boolean;
  is_bulk: boolean;
  list_unsubscribe: string | null;
  unsubscribe_one_click: boolean;
  area: Area | null;
  category: EmailCategory | null;
  priority: 0 | 1 | 2 | 3;
  needs_reply: boolean;
  ai_summary: string | null;
  ai_action: string | null;
  ai_events: AiEvent[];
  ai_tasks: AiTask[];
  ai_status: "pending" | "done" | "skipped" | "error";
  ai_error: string | null;
  status: "neu" | "gelesen" | "erledigt" | "archiviert" | "geloescht";
  deleted_on_server: boolean;
  created_at: string;
}

export interface Chat {
  id: string;
  user_id: string;
  name: string;
  area: Area;
  participants: string[];
  message_count: number;
  last_message_at: string | null;
  last_import_at: string | null;
  summary: string | null;
  key_points: string[];
  open_questions: string[];
  todos: AiTask[];
  events: AiEvent[];
  reply_suggestion: string | null;
  summarized_until: string | null;
  created_at: string;
}

export interface ChatMessageRow {
  id: number;
  user_id: string;
  chat_id: string;
  sent_at: string;
  author: string;
  body: string;
  hash: string;
}

export interface StoredCalendar {
  href: string;
  name: string;
  color: string | null;
  readOnly: boolean;
  sync: boolean;
  area: Area;
}

export interface CalendarConnection {
  id: string;
  user_id: string;
  label: string;
  kind: "caldav" | "ics";
  server_url: string;
  username: string | null;
  calendars: StoredCalendar[];
  write_privat_href: string | null;
  write_beruflich_href: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  enabled: boolean;
  created_at: string;
}

export interface TableTypes {
  events: CalEvent;
  tasks: Task;
  chores: Chore;
  workouts: Workout;
  workout_logs: WorkoutLog;
  recipes: Recipe;
  meal_plan: MealPlanEntry;
  shopping_items: ShoppingItem;
  mail_accounts: MailAccount;
  emails: Email;
  chats: Chat;
  chat_messages: ChatMessageRow;
  calendar_connections: CalendarConnection;
}

export type TableName = keyof TableTypes;
