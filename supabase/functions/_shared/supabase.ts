import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import { HttpError } from "./http.ts";

export type Admin = SupabaseClient;

function serverKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const key = parsed["default"] ?? Object.values(parsed)[0];
      if (key) return key;
    } catch {
      // fall through to the legacy key
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("Kein Server-Schlüssel in der Umgebung gefunden");
}

let cached: Admin | null = null;

/** Client with full database access (bypasses RLS). Only use server-side. */
export function adminClient(): Admin {
  if (!cached) {
    cached = createClient(Deno.env.get("SUPABASE_URL")!, serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export interface AuthUser {
  id: string;
  email?: string;
}

/** Validates the caller's session token and returns the user. */
export async function requireUser(req: Request, admin: Admin): Promise<AuthUser> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.startsWith("sb_")) {
    throw new HttpError(401, "Nicht angemeldet");
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new HttpError(401, "Sitzung abgelaufen – bitte neu anmelden");
  }
  return { id: data.user.id, email: data.user.email ?? undefined };
}

/** True when the request comes from the database scheduler (pg_cron). */
export async function isCronRequest(req: Request, admin: Admin): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret");
  if (!secret) return false;
  const { data, error } = await admin.rpc("check_cron_secret", { p_secret: secret });
  return !error && data === true;
}

export async function readSecret(admin: Admin, name: string): Promise<string | null> {
  const { data, error } = await admin.rpc("read_secret", { p_name: name });
  if (error) throw new Error(`Tresor nicht lesbar: ${error.message}`);
  return (data as string | null) ?? null;
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
  preferences: Record<string, unknown>;
  auto_delete_newsletters: boolean;
  auto_add_events: boolean;
  auto_create_tasks: boolean;
  ai_model: string;
  ai_model_bulk: string;
  ics_token: string;
}

export async function loadSettings(admin: Admin, userId: string): Promise<Settings> {
  const { data, error } = await admin.from("settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Einstellungen nicht lesbar: ${error.message}`);
  if (data) return data as Settings;
  const { data: created, error: insertError } = await admin
    .from("settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  if (insertError) throw new Error(`Einstellungen nicht anlegbar: ${insertError.message}`);
  return created as Settings;
}

/** Throws on a Supabase query error, otherwise returns the data. */
export function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
