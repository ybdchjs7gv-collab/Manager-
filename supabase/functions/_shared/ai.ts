// Claude-Anbindung: strukturierte JSON-Antworten, Fehlertexte auf Deutsch, Kostenprotokoll.
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { type Admin, readSecret } from "./supabase.ts";

interface ModelInfo {
  label: string;
  /** USD per million tokens */
  input: number;
  output: number;
  cacheRead: number;
  supportsEffort: boolean;
  serverFallback: boolean;
}

export const MODELS: Record<string, ModelInfo> = {
  "claude-opus-5-5": {
    label: "Claude Opus 5.5",
    input: 4,
    output: 20,
    cacheRead: 0.2,
    supportsEffort: true,
    serverFallback: true,
  },
  "claude-sonnet-5-5": {
    label: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    cacheRead: 0.2,
    supportsEffort: true,
    serverFallback: true,
  },
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    input: 1,
    output: 5,
    cacheRead: 0.1,
    supportsEffort: false,
    serverFallback: false,
  },
};

export const DEFAULT_MODEL = "claude-opus-5-5";

export function resolveModel(value?: string | null): string {
  return value && value in MODELS ? value : DEFAULT_MODEL;
}

export class AiError extends Error {}

export async function aiClientFor(admin: Admin, userId: string): Promise<Anthropic | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY") || (await readSecret(admin, `ai:${userId}`));
  if (!key) return null;
  return new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 });
}

export function newAiClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
}

export interface JsonCall {
  purpose: string;
  model: string;
  effort: "low" | "medium" | "high";
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

function translateError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError("Der Claude-API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("Der API-Schlüssel darf dieses Modell nicht verwenden.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Gerade zu viele KI-Anfragen – bitte gleich noch einmal versuchen.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return new AiError("Das Guthaben im Claude-Konto ist aufgebraucht.");
    return new AiError(`KI-Anfrage abgelehnt: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("KI-Dienst nicht erreichbar – bitte später erneut versuchen.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`KI-Dienst meldet einen Fehler (${err.status ?? "?"}).`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Sends one request with a JSON schema as output format and returns the parsed object. */
export async function callJson<T>(
  client: Anthropic,
  call: JsonCall,
  log: { admin: Admin; userId: string },
): Promise<T> {
  const model = resolveModel(call.model);
  const info = MODELS[model];
  const outputConfig: { effort?: "low" | "medium" | "high"; format: { type: "json_schema"; schema: Record<string, unknown> } } = {
    format: { type: "json_schema", schema: call.schema },
  };
  if (info.supportsEffort) outputConfig.effort = call.effort;

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: call.maxTokens,
      system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: call.user }],
      output_config: outputConfig,
      ...(info.serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (err) {
    throw translateError(err);
  }

  await logUsage(log, call.purpose, model, response);

  if (response.stop_reason === "refusal") {
    throw new AiError("Die KI hat diese Anfrage abgelehnt.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiError("Die KI-Antwort war zu lang und wurde abgeschnitten.");
  }
  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AiError("Die KI-Antwort konnte nicht gelesen werden.");
  }
}

async function logUsage(
  log: { admin: Admin; userId: string },
  purpose: string,
  requestedModel: string,
  response: Anthropic.Beta.BetaMessage,
): Promise<void> {
  const usage = response.usage;
  const served = response.model in MODELS ? response.model : requestedModel;
  const price = MODELS[served] ?? MODELS[requestedModel];
  const input = usage.input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cost = (input * price.input + cacheWrite * price.input * 1.25 + cacheRead * price.cacheRead + output * price.output) /
    1_000_000;
  const { error } = await log.admin.from("ai_usage").insert({
    user_id: log.userId,
    purpose,
    model: response.model,
    input_tokens: input + cacheWrite,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cost_usd: Number(cost.toFixed(6)),
  });
  if (error) console.error("ai_usage", error.message);
}

/** Cheap request to check that a key works. */
export async function verifyKey(apiKey: string): Promise<void> {
  const client = newAiClient(apiKey);
  try {
    await client.models.retrieve(DEFAULT_MODEL);
  } catch (err) {
    throw translateError(err);
  }
}

// JSON-Schema-Bausteine
export const str = { type: "string" } as const;
export const int = { type: "integer" } as const;
export const bool = { type: "boolean" } as const;
export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
export function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}
export const arr = (items: Record<string, unknown>) => ({ type: "array", items });
export const enumOf = (values: readonly (string | number)[]) =>
  typeof values[0] === "number" ? { type: "integer", enum: values } : { type: "string", enum: values };
