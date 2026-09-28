// Legt das (einzige) Konto der App an – ohne Bestätigungsmail.
// Sobald ein Konto existiert, ist die Registrierung geschlossen.
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Nur POST erlaubt");
  const admin = adminClient();
  const body = await readJson<{ email?: string; password?: string; name?: string }>(req);
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Bitte eine gültige E-Mail-Adresse eingeben.");
  if (password.length < 10) throw new HttpError(400, "Das Passwort muss mindestens 10 Zeichen lang sein.");

  const { data: exists, error: existsError } = await admin.rpc("owner_exists");
  if (existsError) throw new Error(existsError.message);
  if (exists) throw new HttpError(403, "Für diese App gibt es schon ein Konto. Bitte anmelden.");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: body.name ? { name: body.name.trim() } : undefined,
  });
  if (error || !data.user) throw new HttpError(400, error?.message ?? "Konto konnte nicht angelegt werden.");

  if (body.name?.trim()) {
    await admin.from("settings").update({ display_name: body.name.trim() }).eq("user_id", data.user.id);
  }
  return json({ ok: true });
});
