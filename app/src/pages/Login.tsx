import { LogIn, Sparkles, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button, ErrorNote, Field } from "../components/ui";
import { functionsUrl, SUPABASE_PUBLISHABLE_KEY, setDemo } from "../lib/config";
import { supabase } from "../lib/db";

// Der Link zur ersten Registrierung enthält den Einrichtungscode (…/?code=XXXX-XXXX-XXXX).
function codeFromUrl(): string {
  return new URLSearchParams(window.location.search).get("code") ?? "";
}

function removeCodeFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code")) return;
  url.searchParams.delete("code");
  window.history.replaceState(window.history.state, "", url);
}

export function LoginPage() {
  const [mode, setMode] = useState<"checking" | "login" | "register">("checking");
  const [code, setCode] = useState(codeFromUrl);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase!
      .rpc("owner_exists")
      .then(({ data, error: rpcError }) => setMode(rpcError || data ? "login" : "register"));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const res = await fetch(functionsUrl("register"), {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY },
          body: JSON.stringify({ email, password, name, code }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Konto konnte nicht angelegt werden.");
        removeCodeFromUrl();
      }
      const { error: signInError } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        throw new Error(/invalid login/i.test(signInError.message) ? "E-Mail oder Passwort stimmt nicht." : signInError.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startDemo = () => {
    setDemo(true);
    window.location.reload();
  };

  return (
    <div className="login-wrap">
      <form className="card login-card stack loose" onSubmit={submit}>
        <div className="row" style={{ gap: 14 }}>
          <div className="logo">
            <Sparkles size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 750 }}>Manager</h1>
            <p className="muted small">Privat und beruflich – alles an einem Ort.</p>
          </div>
        </div>

        {mode === "checking" && <div className="row muted"><span className="spinner" /> Verbinde …</div>}

        {mode !== "checking" && (
          <>
            <div className="stack tight">
              <h2 style={{ fontSize: 19 }}>{mode === "register" ? "Willkommen! Lege dein Konto an" : "Anmelden"}</h2>
              {mode === "register" && (
                <p className="small muted">
                  Dieses Konto gehört nur dir. Danach ist die Registrierung geschlossen – niemand sonst kann sich anmelden.
                </p>
              )}
            </div>
            {mode === "register" && (
              <Field label="Einrichtungscode" hint="Du hast ihn zusammen mit dem Link zur App bekommen.">
                <input
                  className="input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                />
              </Field>
            )}
            {mode === "register" && (
              <Field label="Dein Vorname">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" required />
              </Field>
            )}
            <Field label="E-Mail-Adresse">
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Passwort" hint={mode === "register" ? "Mindestens 10 Zeichen. Nicht dein E-Mail-Passwort verwenden." : undefined}>
              <input
                className="input"
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                minLength={mode === "register" ? 10 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" block loading={busy} icon={mode === "register" ? <UserPlus size={18} /> : <LogIn size={18} />}>
              {mode === "register" ? "Konto anlegen" : "Anmelden"}
            </Button>
          </>
        )}

        <div className="divider" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={startDemo}>
          Erst einmal mit Beispieldaten ausprobieren
        </button>
      </form>
    </div>
  );
}
