import { CheckCircle2, KeyRound, Laptop, LogOut, RotateCcw, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { loadAiStatus, MODEL_OPTIONS, useAiStatus } from "../../lib/ai";
import { useApp } from "../../lib/app-state";
import { setDemo } from "../../lib/config";
import { db } from "../../lib/db";
import { invalidate } from "../../lib/hooks";
import type { Settings, TimePref } from "../../lib/types";
import { Button, Card, Field, Notice, Toggle, useAction, useToast, WeekdayPicker } from "../ui";

// ---------------------------------------------------------------------------
// KI
// ---------------------------------------------------------------------------

export function AiSettings() {
  const { settings, saveSettings } = useApp();
  const status = useAiStatus();
  const [key, setKey] = useState("");
  const { busy, run } = useAction();

  const saveKey = () =>
    run("key", async () => {
      await db().invoke("ai", { action: "set_key", key: key.trim() });
      setKey("");
      await loadAiStatus(true);
      invalidate("ai_status");
    }, "Schlüssel gespeichert – die KI ist eingeschaltet");

  const removeKey = () =>
    run("remove", async () => {
      if (!confirm("KI-Schlüssel entfernen? Danach sortiert die App ohne KI.")) return;
      await db().rpc("delete_secret", { p_kind: "ai", p_ref: settings.user_id });
      await loadAiStatus(true);
      invalidate("ai_status");
    }, "Schlüssel entfernt");

  const configured = status.data?.configured;

  return (
    <div className="stack">
      <Card title="Claude (KI)" icon={<KeyRound size={18} />}>
        <div className="stack">
          {configured ? (
            <Notice tone="success" icon={<CheckCircle2 size={17} />}>
              KI ist eingeschaltet{status.data?.source === "server" ? " (Schlüssel auf dem Server hinterlegt)" : ""}. Kosten diesen Monat: ca.{" "}
              {(status.data?.cost_month_usd ?? 0).toFixed(2)} $ · letzte 24 Std.: {(status.data?.cost_24h_usd ?? 0).toFixed(2)} $
            </Notice>
          ) : (
            <Notice>
              Die KI sortiert Mails, schreibt Antwortentwürfe, fasst WhatsApp-Chats zusammen und plant Essen und Sport. Dafür brauchst du einen eigenen
              Claude-API-Schlüssel:
              <ol className="steps small" style={{ marginTop: 8 }}>
                <li>
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> öffnen und ein Konto anlegen.
                </li>
                <li>Unter „Billing“ Guthaben aufladen (z. B. 10 $) – abgerechnet wird nur, was du nutzt.</li>
                <li>Unter „API Keys“ einen Schlüssel erstellen und hier einfügen.</li>
              </ol>
            </Notice>
          )}
          {status.data?.source !== "server" && (
            <>
              <Field label={configured ? "Neuen Schlüssel eintragen" : "Claude-API-Schlüssel"}>
                <input className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
              </Field>
              <div className="row wrap">
                <Button variant="primary" loading={busy === "key"} disabled={!key.trim()} onClick={saveKey}>Speichern</Button>
                {configured && status.data?.source === "app" && (
                  <Button variant="danger" icon={<Trash2 size={15} />} loading={busy === "remove"} onClick={removeKey}>Entfernen</Button>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
      <Card title="Modelle">
        <div className="stack">
          <Field label="Für das Sortieren der E-Mails" hint={MODEL_OPTIONS.find((m) => m.id === settings.ai_model_bulk)?.hint}>
            <select className="select" value={settings.ai_model_bulk} onChange={(e) => void saveSettings({ ai_model_bulk: e.target.value })}>
              {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Für Antworten, Zusammenfassungen und Pläne">
            <select className="select" value={settings.ai_model} onChange={(e) => void saveSettings({ ai_model: e.target.value })}>
              {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Field>
          <p className="small muted">
            Bei ca. 50 Mails am Tag kostet das Sortieren mit Opus 5.5 grob 15–20 $ im Monat, mit Haiku 4.5 etwa 3–5 $. Du kannst das jederzeit ändern.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tagesablauf
// ---------------------------------------------------------------------------

const TIME_PREFS: { value: TimePref; label: string }[] = [
  { value: "morgens", label: "morgens" },
  { value: "mittags", label: "mittags" },
  { value: "abends", label: "abends" },
  { value: "egal", label: "egal" },
];

export function RoutineSettings() {
  const { settings, saveSettings } = useApp();
  const [draft, setDraft] = useState<Settings>(settings);
  const { busy, run } = useAction();
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });
  const setPref = (key: string, value: unknown) => setDraft({ ...draft, preferences: { ...draft.preferences, [key]: value } });
  const time = (value: string | null) => (value ?? "").slice(0, 5);

  const save = () =>
    run("save", () => saveSettings({
      day_start: draft.day_start,
      day_end: draft.day_end,
      work_days: draft.work_days,
      work_start: draft.work_start,
      work_end: draft.work_end,
      lunch_start: draft.lunch_start || null,
      lunch_minutes: Number(draft.lunch_minutes) || 0,
      dinner_time: draft.dinner_time || null,
      buffer_minutes: Number(draft.buffer_minutes) || 0,
      max_block_minutes: Number(draft.max_block_minutes) || 90,
      preferences: draft.preferences,
    }), "Tagesablauf gespeichert");

  return (
    <div className="stack">
      <Notice>Danach richtet sich der Planer: Wann du wach bist, wann du arbeitest und wann gegessen wird.</Notice>
      <Card title="Tag">
        <div className="form-grid">
          <Field label="Tag beginnt"><input className="input" type="time" value={time(draft.day_start)} onChange={(e) => set("day_start", e.target.value)} /></Field>
          <Field label="Tag endet"><input className="input" type="time" value={time(draft.day_end)} onChange={(e) => set("day_end", e.target.value)} /></Field>
          <Field label="Mittagspause"><input className="input" type="time" value={time(draft.lunch_start)} onChange={(e) => set("lunch_start", e.target.value)} /></Field>
          <Field label="Pause (Min.)"><input className="input" type="number" inputMode="numeric" value={draft.lunch_minutes} onChange={(e) => set("lunch_minutes", Number(e.target.value))} /></Field>
          <Field label="Abendessen um"><input className="input" type="time" value={time(draft.dinner_time)} onChange={(e) => set("dinner_time", e.target.value)} /></Field>
          <Field label="Puffer zwischen Terminen (Min.)"><input className="input" type="number" inputMode="numeric" value={draft.buffer_minutes} onChange={(e) => set("buffer_minutes", Number(e.target.value))} /></Field>
        </div>
      </Card>
      <Card title="Arbeit">
        <div className="stack">
          <Field label="Arbeitstage"><WeekdayPicker value={draft.work_days} onChange={(v) => set("work_days", v)} /></Field>
          <div className="form-grid">
            <Field label="Arbeitsbeginn"><input className="input" type="time" value={time(draft.work_start)} onChange={(e) => set("work_start", e.target.value)} /></Field>
            <Field label="Feierabend"><input className="input" type="time" value={time(draft.work_end)} onChange={(e) => set("work_end", e.target.value)} /></Field>
            <Field label="Längster Arbeitsblock (Min.)" className="span-2" hint="Längere Aufgaben werden in Blöcke geteilt.">
              <input className="input" type="number" inputMode="numeric" value={draft.max_block_minutes} onChange={(e) => set("max_block_minutes", Number(e.target.value))} />
            </Field>
          </div>
        </div>
      </Card>
      <Card title="Vorlieben">
        <div className="form-grid">
          <Field label="Sport am liebsten">
            <select className="select" value={draft.preferences.workout_time ?? "abends"} onChange={(e) => setPref("workout_time", e.target.value)}>
              {TIME_PREFS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Haushalt am liebsten">
            <select className="select" value={draft.preferences.chore_time ?? "abends"} onChange={(e) => setPref("chore_time", e.target.value)}>
              {TIME_PREFS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Einkaufen einplanen ab … Artikeln"><input className="input" type="number" inputMode="numeric" value={draft.preferences.shopping_min_items ?? 5} onChange={(e) => setPref("shopping_min_items", Number(e.target.value))} /></Field>
          <Field label="Zeit fürs Einkaufen (Min.)"><input className="input" type="number" inputMode="numeric" value={draft.preferences.shopping_minutes ?? 45} onChange={(e) => setPref("shopping_minutes", Number(e.target.value))} /></Field>
          <Field label="Private Aufgaben an Arbeitstagen (Min.)" hint="Höchstens so viel nicht Dringendes pro Tag – der Rest bleibt Freizeit.">
            <input className="input" type="number" inputMode="numeric" value={draft.preferences.flex_minutes_workday ?? 120} onChange={(e) => setPref("flex_minutes_workday", Number(e.target.value))} />
          </Field>
          <Field label="Private Aufgaben an freien Tagen (Min.)">
            <input className="input" type="number" inputMode="numeric" value={draft.preferences.flex_minutes_freeday ?? 240} onChange={(e) => setPref("flex_minutes_freeday", Number(e.target.value))} />
          </Field>
        </div>
      </Card>
      <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Automatik
// ---------------------------------------------------------------------------

export function AutomationSettings() {
  const { settings, saveSettings } = useApp();
  return (
    <Card title="Was die App automatisch erledigen darf">
      <Toggle
        checked={settings.auto_delete_newsletters}
        onChange={(v) => void saveSettings({ auto_delete_newsletters: v })}
        label="Newsletter & Werbung automatisch löschen"
        hint="Verschiebt Mails in den Papierkorb deines Postfachs, wenn die KI sie als Newsletter/Werbung erkennt UND die Mail selbst als Massen-Mail gekennzeichnet ist. Im Papierkorb bleiben sie noch einige Tage wiederherstellbar."
      />
      <div className="divider" />
      <Toggle
        checked={settings.auto_add_events}
        onChange={(v) => void saveSettings({ auto_add_events: v })}
        label="Termine aus Nachrichten automatisch eintragen"
        hint="Nur eindeutige Termine (Datum und Uhrzeit sicher). Unsichere Termine erscheinen als Vorschlag bei der Nachricht."
      />
      <div className="divider" />
      <Toggle
        checked={settings.auto_create_tasks}
        onChange={(v) => void saveSettings({ auto_create_tasks: v })}
        label="Aufgaben aus Nachrichten automatisch anlegen"
        hint="z. B. „Rechnung bis 15.10. bezahlen“ – landet in deinen Aufgaben und wird vom Planer eingeplant."
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Profil & App
// ---------------------------------------------------------------------------

export function ProfileSettings() {
  const { settings, saveSettings, userEmail } = useApp();
  const [name, setName] = useState(settings.display_name ?? "");
  const [waName, setWaName] = useState(settings.preferences.whatsapp_name ?? "");
  const { busy, run } = useAction();
  return (
    <Card title="Profil">
      <div className="stack">
        {userEmail && <span className="small muted">Angemeldet als {userEmail}</span>}
        <Field label="Dein Vorname" hint="Für Begrüßung und die Grußformel in Antwortentwürfen.">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Dein Name in WhatsApp" hint="So erkennt die KI deine eigenen Nachrichten in importierten Chats.">
          <input className="input" value={waName} onChange={(e) => setWaName(e.target.value)} />
        </Field>
        <Button variant="primary" loading={busy === "save"} onClick={() => run("save", () => saveSettings({ display_name: name.trim() || null, preferences: { ...settings.preferences, whatsapp_name: waName.trim() || undefined } }), "Gespeichert")}>
          Speichern
        </Button>
      </div>
    </Card>
  );
}

export function AppSettings() {
  const { demo, signOut } = useApp();
  const toast = useToast();
  const { busy, run } = useAction();
  return (
    <div className="stack">
      <Card title="Auf dem iPhone installieren" icon={<Smartphone size={18} />}>
        <ol className="steps">
          <li>Diese Seite in <b>Safari</b> öffnen.</li>
          <li>Unten auf das Teilen-Symbol tippen (Quadrat mit Pfeil nach oben).</li>
          <li><b>„Zum Home-Bildschirm“</b> wählen und „Hinzufügen“ tippen.</li>
          <li>Ab jetzt die App über das neue Symbol öffnen – sie startet wie eine normale App, ohne Browserleiste.</li>
        </ol>
      </Card>
      <Card title="Auf dem Laptop installieren" icon={<Laptop size={18} />}>
        <ul className="steps">
          <li><b>Chrome oder Edge:</b> in der Adressleiste auf „App installieren“ klicken.</li>
          <li><b>Safari auf dem Mac:</b> Menü „Ablage“ → „Zum Dock hinzufügen“.</li>
        </ul>
        <p className="small muted" style={{ marginTop: 8 }}>Handy und Laptop zeigen immer dieselben Daten – Änderungen erscheinen sofort auf beiden Geräten.</p>
      </Card>
      <Card title="Konto">
        <div className="row wrap">
          {demo && (
            <Button icon={<RotateCcw size={16} />} onClick={async () => {
              const { resetDemo } = await import("../../lib/demo");
              resetDemo();
              window.location.reload();
            }}>
              Beispieldaten zurücksetzen
            </Button>
          )}
          <Button variant="danger" icon={<LogOut size={16} />} loading={busy === "out"} onClick={() => run("out", signOut)}>
            {demo ? "Demo beenden" : "Abmelden"}
          </Button>
          {!demo && (
            <Button size="sm" variant="ghost" onClick={() => { setDemo(true); toast.show("Wechsle in den Demo-Modus …"); setTimeout(() => window.location.reload(), 600); }}>
              Demo-Modus ansehen
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
