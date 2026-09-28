// KI-Funktionen der App: Antwortentwurf, Chat-Zusammenfassung, Schnell-Erfassen,
// Essens- und Sportplan, Tagesbriefing, API-Schlüssel verwalten.
import { aiClientFor, callJson, MODELS, resolveModel, verifyKey } from "../_shared/ai.ts";
import { createEvents, createTasks } from "../_shared/events.ts";
import { pushPending } from "../_shared/calsync.ts";
import { errorMessage, HttpError, json, readJson, serve } from "../_shared/http.ts";
import {
  type ChatSummary,
  chatSummarySchema,
  chatSummarySystem,
  type DayBriefing,
  dayBriefingSchema,
  dayBriefingSystem,
  type MealPlanResult,
  mealPlanSchema,
  mealPlanSystem,
  quickAddSchema,
  quickAddSystem,
  type QuickItem,
  type ReplyDraft,
  replyDraftSchema,
  replyDraftSystem,
  replyDraftUser,
  type WorkoutPlanResult,
  workoutPlanSchema,
  workoutPlanSystem,
} from "../_shared/prompts.ts";
import { type Admin, adminClient, loadSettings, readSecret, requireUser, type Settings } from "../_shared/supabase.ts";
import { stripQuotedReply, truncate } from "../_shared/text.ts";
import { formatGerman, localDate } from "../_shared/time.ts";

const WEEKDAY = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Berlin",
});
const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

async function busyText(admin: Admin, userId: string, days: number): Promise<string> {
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const { data } = await admin
    .from("events")
    .select("title, start_at, end_at, all_day")
    .eq("user_id", userId)
    .neq("sync_state", "delete")
    .neq("status", "cancelled")
    .gte("end_at", now.toISOString())
    .lte("start_at", until.toISOString())
    .order("start_at")
    .limit(80);
  return (data ?? [])
    .map((e) => {
      const start = new Date(e.start_at);
      if (e.all_day) return `${WEEKDAY.format(start)} ganztägig: ${e.title}`;
      return `${WEEKDAY.format(start)} ${TIME.format(start)}–${TIME.format(new Date(e.end_at))}: ${e.title}`;
    })
    .join("\n");
}

async function requireClient(admin: Admin, userId: string) {
  const client = await aiClientFor(admin, userId);
  if (!client) {
    throw new HttpError(400, "Für KI-Funktionen fehlt noch der Claude-API-Schlüssel (Einstellungen → KI).");
  }
  return client;
}

function todayText(settings: Settings): string {
  return formatGerman(new Date(), settings.timezone, true);
}

serve(async (req) => {
  const admin = adminClient();
  const user = await requireUser(req, admin);
  const body = await readJson<Record<string, unknown>>(req);
  const action = String(body.action ?? "");
  const log = { admin, userId: user.id };

  switch (action) {
    case "status": {
      const envKey = Boolean(Deno.env.get("ANTHROPIC_API_KEY"));
      const userKey = envKey ? false : Boolean(await readSecret(admin, `ai:${user.id}`));
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const { data: usage } = await admin
        .from("ai_usage")
        .select("cost_usd, created_at")
        .eq("user_id", user.id)
        .gte("created_at", monthStart.toISOString());
      const dayStart = new Date(Date.now() - 86_400_000).toISOString();
      const month = (usage ?? []).reduce((sum, u) => sum + Number(u.cost_usd), 0);
      const last24h = (usage ?? []).filter((u) => u.created_at >= dayStart).reduce((sum, u) => sum + Number(u.cost_usd), 0);
      return json({
        configured: envKey || userKey,
        source: envKey ? "server" : userKey ? "app" : null,
        cost_month_usd: Number(month.toFixed(4)),
        cost_24h_usd: Number(last24h.toFixed(4)),
        models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, input: m.input, output: m.output })),
      });
    }

    case "set_key": {
      const key = String(body.key ?? "").trim();
      if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
        throw new HttpError(400, "Das sieht nicht wie ein Claude-API-Schlüssel aus (beginnt mit sk-ant-).");
      }
      try {
        await verifyKey(key);
      } catch (err) {
        throw new HttpError(400, errorMessage(err));
      }
      const { error } = await admin.rpc("admin_set_secret", { p_name: `ai:${user.id}`, p_secret: key });
      if (error) throw new Error(error.message);
      // Mails that were sorted without AI get another chance.
      await admin.from("emails").update({ ai_status: "pending" }).eq("user_id", user.id).eq("ai_status", "skipped").in("status", [
        "neu",
        "gelesen",
      ]);
      return json({ ok: true });
    }

    case "draft_reply": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const { data: email } = await admin.from("emails").select("*").eq("id", String(body.email_id ?? "")).eq("user_id", user.id)
        .maybeSingle();
      if (!email) throw new HttpError(404, "E-Mail nicht gefunden");
      const draft = await callJson<ReplyDraft>(client, {
        purpose: "reply_draft",
        model: resolveModel(settings.ai_model),
        effort: "medium",
        system: replyDraftSystem(settings.display_name),
        schema: replyDraftSchema,
        maxTokens: 8000,
        user: replyDraftUser({
          today: todayText(settings),
          area: email.area ?? "privat",
          fromName: email.from_name,
          fromEmail: email.from_email,
          subject: email.subject,
          date: email.sent_at ? formatGerman(new Date(email.sent_at), settings.timezone) : null,
          body: truncate(stripQuotedReply(email.body_text ?? ""), 10_000),
          instruction: body.instruction ? String(body.instruction).slice(0, 1000) : null,
          busy: await busyText(admin, user.id, 14),
        }),
      }, log);
      return json({ ok: true, ...draft });
    }

    case "summarize_chat": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const { data: chat } = await admin.from("chats").select("*").eq("id", String(body.chat_id ?? "")).eq("user_id", user.id)
        .maybeSingle();
      if (!chat) throw new HttpError(404, "Chat nicht gefunden");
      const full = Boolean(body.full);
      let query = admin.from("chat_messages").select("sent_at, author, body").eq("chat_id", chat.id).order("sent_at", {
        ascending: false,
      }).limit(600);
      if (!full && chat.summarized_until) query = query.gt("sent_at", chat.summarized_until);
      const { data: messages } = await query;
      const list = (messages ?? []).reverse();
      if (list.length === 0) return json({ ok: true, unchanged: true });

      const lines: string[] = [];
      let size = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        const line = `[${WEEKDAY.format(new Date(m.sent_at))} ${TIME.format(new Date(m.sent_at))}] ${m.author}: ${m.body}`;
        size += line.length;
        if (size > 60_000) break;
        lines.unshift(line);
      }
      const ownName = (settings.preferences?.whatsapp_name as string | undefined) ?? null;
      const result = await callJson<ChatSummary>(client, {
        purpose: "chat_summary",
        model: resolveModel(settings.ai_model),
        effort: "medium",
        system: chatSummarySystem(settings.display_name, ownName),
        schema: chatSummarySchema,
        maxTokens: 8000,
        user: `Heute ist ${todayText(settings)}.
Chat: ${chat.name}
${!full && chat.summary ? `Bisherige Zusammenfassung: ${chat.summary}\n` : ""}
<daten>
${lines.join("\n")}
</daten>`,
      }, log);

      const lastAt = list[list.length - 1].sent_at;
      await admin.from("chats").update({
        area: result.area,
        summary: result.summary,
        key_points: result.key_points,
        open_questions: result.open_questions,
        todos: result.todos,
        events: result.events,
        reply_suggestion: result.reply_suggestion || null,
        summarized_until: lastAt,
      }).eq("id", chat.id);

      const origin = {
        area: result.area,
        source: "whatsapp" as const,
        sourceRef: chat.id as string,
        description: `Aus WhatsApp-Chat „${chat.name}“`,
      };
      let eventsCreated = 0;
      let tasksCreated = 0;
      if (settings.auto_add_events) {
        eventsCreated = (await createEvents(
          admin,
          user.id,
          settings.timezone,
          result.events.filter((e) => e.confidence === "hoch"),
          origin,
        )).length;
        if (eventsCreated > 0) await pushPending(admin, user.id, settings.timezone).catch(() => undefined);
      }
      if (settings.auto_create_tasks) tasksCreated = await createTasks(admin, user.id, result.todos, origin);
      return json({ ok: true, ...result, events_created: eventsCreated, tasks_created: tasksCreated });
    }

    case "quick_add": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const text = String(body.text ?? "").trim().slice(0, 2000);
      if (!text) throw new HttpError(400, "Bitte etwas eingeben.");
      const result = await callJson<{ items: QuickItem[] }>(client, {
        purpose: "quick_add",
        model: resolveModel(settings.ai_model),
        effort: "low",
        system: quickAddSystem(settings.display_name),
        schema: quickAddSchema,
        maxTokens: 4000,
        user: `Heute ist ${todayText(settings)}.\n\n<daten>\n${text}\n</daten>`,
      }, log);
      return json({ ok: true, items: result.items });
    }

    case "plan_meals": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const days = (body.days as { date: string; note?: string }[] | undefined) ?? [];
      if (days.length === 0 || days.length > 14) throw new HttpError(400, "Bitte 1 bis 14 Tage auswählen.");
      const meals = (body.meals as string[] | undefined) ?? ["abend"];
      const { data: recipes } = await admin.from("recipes").select("name").eq("user_id", user.id).limit(60);
      const result = await callJson<MealPlanResult>(client, {
        purpose: "meal_plan",
        model: resolveModel(settings.ai_model),
        effort: "medium",
        system: mealPlanSystem(settings.display_name),
        schema: mealPlanSchema,
        maxTokens: 16000,
        user: `Heute ist ${todayText(settings)}.
Personen: ${Number(body.persons ?? 2)}
Mahlzeiten: ${meals.join(", ")}
Vorlieben/Ernährung: ${String(body.preferences ?? "keine besonderen")}
Nicht mögen: ${String(body.dislikes ?? "–")}
Vorhandene Lieblingsrezepte (dürfen wiederkommen): ${(recipes ?? []).map((r) => r.name).join(", ") || "–"}

Tage:
${days.map((d) => `- ${d.date}${d.note ? ` (${d.note})` : ""}`).join("\n")}`,
      }, log);
      return json({ ok: true, ...result });
    }

    case "plan_workouts": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const result = await callJson<WorkoutPlanResult>(client, {
        purpose: "workout_plan",
        model: resolveModel(settings.ai_model),
        effort: "medium",
        system: workoutPlanSystem(settings.display_name),
        schema: workoutPlanSchema,
        maxTokens: 8000,
        user: `Ziel: ${String(body.goal ?? "fitter werden")}
Fitnesslevel: ${String(body.level ?? "mittel")}
Einheiten pro Woche: ${Number(body.per_week ?? 3)}
Zeit pro Einheit: ${Number(body.minutes ?? 45)} Minuten
Mögliche Wochentage: ${String(body.weekdays ?? "flexibel")}
Bevorzugte Tageszeit: ${String(body.preferred_time ?? "egal")}
Vorlieben/Einschränkungen: ${String(body.notes ?? "–")}`,
      }, log);
      return json({ ok: true, ...result });
    }

    case "day_briefing": {
      const settings = await loadSettings(admin, user.id);
      const client = await requireClient(admin, user.id);
      const context = truncate(String(body.context ?? ""), 20_000);
      const result = await callJson<DayBriefing>(client, {
        purpose: "day_briefing",
        model: resolveModel(settings.ai_model),
        effort: "low",
        system: dayBriefingSystem(settings.display_name),
        schema: dayBriefingSchema,
        maxTokens: 4000,
        user: `Heute ist ${todayText(settings)} (Datum ${
          localDate(new Date(), settings.timezone)
        }).\n\n<daten>\n${context}\n</daten>`,
      }, log);
      return json({ ok: true, ...result });
    }

    default:
      throw new HttpError(400, `Unbekannte Aktion: ${action}`);
  }
});
