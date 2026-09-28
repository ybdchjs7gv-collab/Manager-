import { db } from "./db";
import { useLive } from "./hooks";

export interface AiStatus {
  configured: boolean;
  source: "server" | "app" | "demo" | null;
  cost_month_usd: number;
  cost_24h_usd: number;
  models: { id: string; label: string; input: number; output: number }[];
}

let cached: Promise<AiStatus> | null = null;

export function loadAiStatus(force = false): Promise<AiStatus> {
  if (!cached || force) {
    cached = db().invoke<AiStatus>("ai", { action: "status" }).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}

export function useAiStatus() {
  return useLive(["ai_status"], () => loadAiStatus());
}

export async function callAi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return await db().invoke<T>("ai", { action, ...body });
}

export const MODEL_OPTIONS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 – beste Qualität", hint: "ca. 1–1,5 Cent pro E-Mail" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 – schnell & günstiger", hint: "ca. 0,5 Cent pro E-Mail" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 – am günstigsten", hint: "ca. 0,2 Cent pro E-Mail" },
];
