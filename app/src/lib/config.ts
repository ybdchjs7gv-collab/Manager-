// Verbindungsdaten zum Supabase-Projekt. Beide Werte sind öffentlich (Schutz über Row Level Security).
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

const DEMO_FLAG = "manager.demo";

export function isDemo(): boolean {
  if (!isConfigured) return true;
  try {
    return localStorage.getItem(DEMO_FLAG) === "1";
  } catch {
    return false;
  }
}

export function setDemo(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEMO_FLAG, "1");
    else localStorage.removeItem(DEMO_FLAG);
  } catch {
    // storage blocked – demo stays off
  }
}

export function functionsUrl(name: string): string {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}
