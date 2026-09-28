// Kalender-Abo (ICS) mit allen Terminen aus der App.
// Aufruf: GET /functions/v1/calendar-feed?token=<geheimer Schlüssel aus den Einstellungen>
import { buildCalendar, type CalEventInput } from "../_shared/ical.ts";
import { corsHeaders } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response("Nicht gefunden", { status: 404 });

  const admin = adminClient();
  const { data: settings } = await admin.from("settings").select("user_id, timezone").eq("ics_token", token).maybeSingle();
  if (!settings) return new Response("Nicht gefunden", { status: 404 });

  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const until = new Date(Date.now() + 366 * 86_400_000).toISOString();
  const { data: events, error } = await admin
    .from("events")
    .select("id, title, description, location, start_at, end_at, all_day, status, reminder_minutes, updated_at, area, kind")
    .eq("user_id", settings.user_id)
    .neq("source", "caldav")
    .neq("sync_state", "delete")
    .neq("status", "cancelled")
    .gte("end_at", from)
    .lte("start_at", until)
    .order("start_at")
    .limit(3000);
  if (error) return new Response("Fehler", { status: 500 });

  const items: CalEventInput[] = (events ?? []).map((e) => ({
    uid: `${e.id}@manager.app`,
    title: e.title,
    description: e.description,
    location: e.location,
    start: new Date(e.start_at),
    end: new Date(e.end_at),
    allDay: e.all_day,
    reminderMinutes: e.reminder_minutes,
    status: e.status === "tentative" ? "TENTATIVE" : "CONFIRMED",
    categories: [e.area === "beruflich" ? "Beruflich" : "Privat"],
    lastModified: new Date(e.updated_at),
  }));

  const ics = buildCalendar(items, settings.timezone, { feed: true, name: "Manager" });
  return new Response(ics, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="manager.ics"',
      "Cache-Control": "no-cache",
    },
  });
});
