// Kalender-Abgleich mit iCloud (CalDAV): verbinden, Kalender wählen, Termine abgleichen.
import { discover } from "../_shared/caldav.ts";
import {
  type CalendarConnection,
  connectionAuth,
  loadConnections,
  pullConnection,
  pushPending,
  type StoredCalendar,
} from "../_shared/calsync.ts";
import { errorMessage, HttpError, json, readJson, serve } from "../_shared/http.ts";
import { type Admin, adminClient, isCronRequest, loadSettings, requireUser } from "../_shared/supabase.ts";

function httpsUrl(value: unknown): string {
  const url = String(value ?? "https://caldav.icloud.com/").trim();
  if (!/^https:\/\/[^/]+/i.test(url)) throw new HttpError(400, "Die Kalender-Adresse muss mit https:// beginnen.");
  return url;
}

async function syncUser(admin: Admin, userId: string, pushOnly: boolean) {
  const settings = await loadSettings(admin, userId);
  const push = await pushPending(admin, userId, settings.timezone);
  const pulls: Record<string, unknown>[] = [];
  if (!pushOnly) {
    for (const conn of await loadConnections(admin, userId)) {
      try {
        const auth = await connectionAuth(admin, conn);
        if (!auth) throw new Error("Kein Passwort gespeichert");
        const res = await pullConnection(admin, conn, auth, settings.timezone);
        await admin.from("calendar_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq(
          "id",
          conn.id,
        );
        pulls.push({ connection: conn.label, ...res });
      } catch (err) {
        const message = errorMessage(err).slice(0, 300);
        await admin.from("calendar_connections").update({ last_sync_at: new Date().toISOString(), last_error: message }).eq(
          "id",
          conn.id,
        );
        pulls.push({ connection: conn.label, error: message });
      }
    }
  }
  return { push, pulls };
}

serve(async (req) => {
  const admin = adminClient();
  const body = await readJson<Record<string, unknown>>(req);

  if (await isCronRequest(req, admin)) {
    const { data } = await admin.from("calendar_connections").select("user_id").eq("enabled", true);
    const users = [...new Set((data ?? []).map((r) => r.user_id as string))];
    const results = [];
    for (const userId of users) results.push(await syncUser(admin, userId, false));
    return json({ ok: true, results });
  }

  const user = await requireUser(req, admin);
  const action = String(body.action ?? "sync");

  switch (action) {
    case "discover": {
      const serverUrl = httpsUrl(body.server_url);
      const username = String(body.username ?? "").trim();
      let password = String(body.password ?? "");
      if (!password && body.connection_id) {
        const { data: conn } = await admin.from("calendar_connections").select("*").eq("id", String(body.connection_id)).eq(
          "user_id",
          user.id,
        ).maybeSingle();
        if (conn) password = (await admin.rpc("read_secret", { p_name: `cal:${conn.id}` })).data ?? "";
      }
      if (!username || !password) throw new HttpError(400, "Bitte Apple-ID (E-Mail) und app-spezifisches Passwort eingeben.");
      try {
        const found = await discover(serverUrl, username, password);
        return json({ ok: true, ...found });
      } catch (err) {
        throw new HttpError(400, errorMessage(err));
      }
    }

    case "save": {
      const input = body.connection as Partial<CalendarConnection> & { password?: string };
      const serverUrl = httpsUrl(input.server_url);
      const username = String(input.username ?? "").trim();
      let existing: CalendarConnection | null = null;
      if (input.id) {
        const { data } = await admin.from("calendar_connections").select("*").eq("id", input.id).eq("user_id", user.id)
          .maybeSingle();
        existing = data as CalendarConnection | null;
        if (!existing) throw new HttpError(404, "Verbindung nicht gefunden");
      }
      let password = input.password ?? "";
      if (!password && existing) password = (await admin.rpc("read_secret", { p_name: `cal:${existing.id}` })).data ?? "";
      if (!username || !password) throw new HttpError(400, "Apple-ID und app-spezifisches Passwort fehlen.");

      let found;
      try {
        found = await discover(serverUrl, username, password);
      } catch (err) {
        throw new HttpError(400, errorMessage(err));
      }
      const wanted = new Map((input.calendars ?? []).map((c) => [c.href, c]));
      const calendars: StoredCalendar[] = found.calendars.map((c) => ({
        href: c.href,
        name: c.name,
        color: c.color,
        readOnly: c.readOnly,
        sync: wanted.get(c.href)?.sync ?? true,
        area: wanted.get(c.href)?.area ?? (/arbeit|work|büro|job|beruf/i.test(c.name) ? "beruflich" : "privat"),
      }));
      const writable = calendars.filter((c) => !c.readOnly);
      const pick = (href: string | null | undefined, area: string) =>
        (href && writable.some((c) => c.href === href) ? href : null) ??
          writable.find((c) => c.area === area)?.href ?? writable[0]?.href ?? null;
      const row = {
        user_id: user.id,
        label: input.label?.trim() || existing?.label || "iCloud",
        kind: "caldav",
        server_url: serverUrl,
        username,
        principal_url: found.principalUrl,
        home_url: found.homeUrl,
        calendars,
        write_privat_href: pick(input.write_privat_href, "privat"),
        write_beruflich_href: pick(input.write_beruflich_href, "beruflich"),
        enabled: input.enabled ?? true,
        last_error: null,
      };
      const saved = existing
        ? await admin.from("calendar_connections").update(row).eq("id", existing.id).select("*").single()
        : await admin.from("calendar_connections").insert(row).select("*").single();
      if (saved.error) throw new Error(saved.error.message);
      if (input.password) {
        const { error } = await admin.rpc("admin_set_secret", { p_name: `cal:${saved.data.id}`, p_secret: input.password });
        if (error) throw new Error(error.message);
      }
      // Local events created before the connection existed go to the calendar now.
      await admin.from("events").update({ sync_state: "pending" }).eq("user_id", user.id).eq("sync_state", "local").gte(
        "end_at",
        new Date().toISOString(),
      );
      const result = await syncUser(admin, user.id, false);
      return json({ ok: true, connection: saved.data, result });
    }

    case "push":
      return json({ ok: true, ...(await syncUser(admin, user.id, true)) });

    case "sync":
      return json({ ok: true, ...(await syncUser(admin, user.id, false)) });

    default:
      throw new HttpError(400, `Unbekannte Aktion: ${action}`);
  }
});
