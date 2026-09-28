// Datenzugriff: entweder Supabase (echte Daten, auf allen Geräten gleich)
// oder der Demo-Speicher im Browser.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isConfigured, isDemo, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import type { Settings, TableName, TableTypes } from "./types";

export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "is";
export type Cond = [string, Op, unknown];

export interface Query {
  where?: Cond[];
  order?: [string, "asc" | "desc"][];
  limit?: number;
}

export interface Backend {
  readonly mode: "supabase" | "demo";
  list<K extends TableName>(table: K, query?: Query): Promise<TableTypes[K][]>;
  count(table: TableName, where?: Cond[]): Promise<number>;
  insert<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[]): Promise<TableTypes[K][]>;
  insertIgnoreDuplicates<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[], onConflict: string): Promise<void>;
  update<K extends TableName>(table: K, where: Cond[], patch: Partial<TableTypes[K]>): Promise<TableTypes[K][]>;
  remove(table: TableName, where: Cond[]): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  rpc<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  invoke<T>(fn: string, body: Record<string, unknown>): Promise<T>;
  subscribe(onChange: (table: TableName) => void): () => void;
}

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "manager.auth" },
  })
  : null;

class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  constructor(private client: SupabaseClient) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyWhere(query: any, where: Cond[] = []) {
    for (const [col, op, value] of where) {
      switch (op) {
        case "in":
          query = query.in(col, value as unknown[]);
          break;
        case "notIn":
          query = query.not(col, "in", `(${(value as unknown[]).map((v) => JSON.stringify(v)).join(",")})`);
          break;
        case "is":
          query = query.is(col, value);
          break;
        default:
          query = query[op](col, value);
      }
    }
    return query;
  }

  private check<T>(result: { data: T; error: { message: string } | null }): T {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async list<K extends TableName>(table: K, q: Query = {}): Promise<TableTypes[K][]> {
    let query = this.applyWhere(this.client.from(table).select("*"), q.where);
    for (const [col, dir] of q.order ?? []) query = query.order(col, { ascending: dir === "asc" });
    if (q.limit) query = query.limit(q.limit);
    return (this.check(await query) ?? []) as TableTypes[K][];
  }

  async count(table: TableName, where: Cond[] = []): Promise<number> {
    const query = this.applyWhere(this.client.from(table).select("id", { count: "exact", head: true }), where);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async insert<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[]): Promise<TableTypes[K][]> {
    if (rows.length === 0) return [];
    return (this.check(await this.client.from(table as string).insert(rows as Record<string, unknown>[]).select("*")) ?? []) as TableTypes[K][];
  }

  async insertIgnoreDuplicates<K extends TableName>(table: K, rows: Partial<TableTypes[K]>[], onConflict: string) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      this.check(await this.client.from(table as string).upsert(chunk as Record<string, unknown>[], { onConflict, ignoreDuplicates: true }));
    }
  }

  async update<K extends TableName>(table: K, where: Cond[], patch: Partial<TableTypes[K]>): Promise<TableTypes[K][]> {
    const query = this.applyWhere(this.client.from(table as string).update(patch as Record<string, unknown>), where).select("*");
    return (this.check(await query) ?? []) as TableTypes[K][];
  }

  async remove(table: TableName, where: Cond[]): Promise<void> {
    if (where.length === 0) throw new Error("Löschen ohne Bedingung ist nicht erlaubt");
    this.check(await this.applyWhere(this.client.from(table).delete(), where));
  }

  async getSettings(): Promise<Settings> {
    const { data: auth } = await this.client.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) throw new Error("Nicht angemeldet");
    const existing = this.check(await this.client.from("settings").select("*").eq("user_id", userId).maybeSingle());
    if (existing) return existing as Settings;
    return this.check(await this.client.from("settings").insert({ user_id: userId }).select("*").single()) as Settings;
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    return this.check(
      await this.client.from("settings").update(patch).eq("user_id", current.user_id).select("*").single(),
    ) as Settings;
  }

  async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.check(await this.client.rpc(name, args)) as T;
  }

  async invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.functions.invoke(fn, { body });
    if (error) {
      let message = error.message;
      try {
        const context = (error as { context?: Response }).context;
        const payload = context ? await context.json() : null;
        if (payload?.error) message = payload.error;
      } catch {
        // keep generic message
      }
      if (/Failed to send a request|Failed to fetch/i.test(message)) message = "Keine Verbindung zum Server.";
      throw new Error(message);
    }
    return data as T;
  }

  subscribe(onChange: (table: TableName) => void): () => void {
    const channel = this.client.channel(`manager-${Math.random().toString(36).slice(2)}`);
    for (const table of ["emails", "events", "tasks", "shopping_items"] as TableName[]) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange(table));
    }
    channel.subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}

let backend: Backend | null = null;

export async function initBackend(): Promise<Backend> {
  if (backend) return backend;
  if (isDemo() || !supabase) {
    const { DemoBackend } = await import("./demo");
    backend = new DemoBackend();
  } else {
    backend = new SupabaseBackend(supabase);
  }
  return backend;
}

/** The active backend (after initBackend()). */
export function db(): Backend {
  if (!backend) throw new Error("Backend nicht initialisiert");
  return backend;
}
