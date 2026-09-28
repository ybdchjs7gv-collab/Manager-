// Legt das (einzige) Konto der App an – ohne Bestätigungsmail und nur mit dem
// Einrichtungscode aus dem Tresor. Sobald ein Konto existiert, ist die
// Registrierung geschlossen.
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { adminClient, readSecret } from "../_shared/supabase.ts";

// Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen keine Rolle.
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Vergleich in konstanter Zeit, damit die Antwortzeit nichts über den Code verrät.
function sameCode(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(normalizeCode(given));
  const b = new TextEncoder().encode(normalizeCode(expected));
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  return diff === 0 && b.length > 0;
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Nur POST erlaubt");
  const admin = adminClient();
  const body = await readJson<{ email?: string; password?: string; name?: string; code?: string }>(req);
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const name = body.name?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Bitte eine gültige E-Mail-Adresse eingeben.");
  if (password.length < 10) throw new HttpError(400, "Das Passwort muss mindestens 10 Zeichen lang sein.");

  const { data: exists, error: existsError } = await admin.rpc("owner_exists");
  if (existsError) throw new Error(existsError.message);
  if (exists) throw new HttpError(403, "Für diese App gibt es schon ein Konto. Bitte anmelden.");

  const expected = await readSecret(admin, "setup_code");
  if (!expected) throw new HttpError(503, "Die Registrierung ist noch nicht eingerichtet (Einrichtungscode fehlt).");
  if (!sameCode(body.code ?? "", expected)) throw new HttpError(403, "Der Einrichtungscode stimmt nicht.");

  // Einmal-Ticket: nur damit lässt die Datenbank ein neues Konto zu.
  const nonce = crypto.randomUUID();
  const { error: ticketError } = await admin.from("registration_tickets").insert({ nonce });
  if (ticketError) throw new Error(ticketError.message);
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { ...(name ? { name } : {}), registration_nonce: nonce },
    });
    if (error || !data.user) {
      const message = error?.message ?? "";
      throw new HttpError(
        400,
        /database error/i.test(message)
          ? "Konto konnte nicht angelegt werden. Bitte lade die Seite neu – vielleicht gibt es schon ein Konto."
          : message || "Konto konnte nicht angelegt werden.",
      );
    }
    // Das Ticket hat seinen Zweck erfüllt und bleibt nicht in den Profildaten.
    await admin.auth.admin.updateUserById(data.user.id, { user_metadata: { registration_nonce: null } });
    if (name) await admin.from("settings").update({ display_name: name }).eq("user_id", data.user.id);
  } finally {
    await admin.from("registration_tickets").delete().eq("nonce", nonce);
  }
  return json({ ok: true });
});
