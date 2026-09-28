import { CalendarDays, Copy, Link2, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../lib/app-state";
import { SUPABASE_URL } from "../../lib/config";
import { relativeStamp } from "../../lib/dates";
import { db } from "../../lib/db";
import { invalidate, useLive } from "../../lib/hooks";
import type { Area, CalendarConnection, StoredCalendar } from "../../lib/types";
import { Button, Card, Field, Notice, Segmented, Toggle, useAction, useToast } from "../ui";

interface Discovered {
  calendars: { href: string; name: string; color: string | null; readOnly: boolean }[];
}

export function CalendarSettings() {
  const connections = useLive(["calendar_connections"], () => db().list("calendar_connections", { order: [["created_at", "asc"]] }));
  const conn = connections.data?.[0];
  return (
    <div className="stack">
      <Card title="iPhone-Kalender (iCloud)" icon={<Smartphone size={18} />}>
        <ConnectionForm key={conn?.id ?? "new"} connection={conn} />
      </Card>
      <FeedCard />
    </div>
  );
}

function ConnectionForm({ connection }: { connection?: CalendarConnection }) {
  const [username, setUsername] = useState(connection?.username ?? "");
  const [password, setPassword] = useState("");
  const [calendars, setCalendars] = useState<StoredCalendar[]>(connection?.calendars ?? []);
  const [writePrivat, setWritePrivat] = useState(connection?.write_privat_href ?? "");
  const [writeBeruflich, setWriteBeruflich] = useState(connection?.write_beruflich_href ?? "");
  const { busy, run } = useAction();
  const toast = useToast();

  const discover = () =>
    run("discover", async () => {
      const found = await db().invoke<Discovered>("calendar-sync", {
        action: "discover",
        server_url: "https://caldav.icloud.com/",
        username: username.trim(),
        password: password || undefined,
        connection_id: connection?.id,
      });
      const previous = new Map(calendars.map((c) => [c.href, c]));
      const next = found.calendars.map((c) => ({
        ...c,
        sync: previous.get(c.href)?.sync ?? true,
        area: previous.get(c.href)?.area ?? ((/arbeit|work|büro|job|beruf/i.test(c.name) ? "beruflich" : "privat") as Area),
      }));
      setCalendars(next);
      const writable = next.filter((c) => !c.readOnly);
      if (!writePrivat) setWritePrivat(writable.find((c) => c.area === "privat")?.href ?? writable[0]?.href ?? "");
      if (!writeBeruflich) setWriteBeruflich(writable.find((c) => c.area === "beruflich")?.href ?? writable[0]?.href ?? "");
      toast.show(`${next.length} Kalender gefunden`);
    });

  const save = () =>
    run("save", async () => {
      await db().invoke("calendar-sync", {
        action: "save",
        connection: {
          id: connection?.id,
          label: "iCloud",
          server_url: "https://caldav.icloud.com/",
          username: username.trim(),
          password: password || undefined,
          calendars,
          write_privat_href: writePrivat || null,
          write_beruflich_href: writeBeruflich || null,
        },
      });
      setPassword("");
      invalidate("calendar_connections", "events");
    }, "Kalender verbunden und abgeglichen");

  const sync = () =>
    run("sync", async () => {
      await db().invoke("calendar-sync", { action: "sync" });
      invalidate("calendar_connections", "events");
    }, "Abgeglichen");

  const remove = () =>
    run("delete", async () => {
      if (!connection || !confirm("Verbindung zum iPhone-Kalender trennen? Termine im iPhone bleiben erhalten.")) return;
      await db().remove("events", [["cal_connection_id", "eq", connection.id], ["source", "eq", "caldav"]]);
      await db().update("events", [["cal_connection_id", "eq", connection.id]], {
        cal_connection_id: null, cal_href: null, ext_uid: null, ext_href: null, ext_etag: null, sync_state: "local",
      });
      await db().remove("calendar_connections", [["id", "eq", connection.id]]);
      invalidate("calendar_connections", "events");
    }, "Verbindung getrennt");

  const writable = calendars.filter((c) => !c.readOnly);

  return (
    <div className="stack">
      {!connection && (
        <Notice>
          Verbinde deinen iCloud-Kalender, dann landen Termine aus der App direkt in deinem iPhone-Kalender – und deine iPhone-Termine erscheinen hier und
          werden beim Planen berücksichtigt.
          <ol className="steps small" style={{ marginTop: 8 }}>
            <li>account.apple.com öffnen → „Anmelden und Sicherheit“ → „App-spezifische Passwörter“.</li>
            <li>Ein neues Passwort erstellen (Name z. B. „Manager“) und hier eintragen.</li>
            <li>Als Benutzername deine Apple-ID (E-Mail-Adresse) verwenden.</li>
          </ol>
        </Notice>
      )}
      {connection?.last_error && <Notice tone="danger">{connection.last_error}</Notice>}
      {connection && !connection.last_error && (
        <span className="small muted">Zuletzt abgeglichen {connection.last_sync_at ? relativeStamp(connection.last_sync_at) : "–"} · automatisch alle 15 Minuten</span>
      )}
      <div className="form-grid">
        <Field label="Apple-ID (E-Mail)" className="span-2">
          <input className="input" type="email" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="App-spezifisches Passwort" className="span-2" hint={connection ? "Leer lassen, um das gespeicherte Passwort zu behalten." : "Format: xxxx-xxxx-xxxx-xxxx"}>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
      <Button icon={<CalendarDays size={17} />} loading={busy === "discover"} disabled={!username || (!password && !connection)} onClick={discover}>
        Kalender suchen
      </Button>

      {calendars.length > 0 && (
        <>
          <div className="section-title">Welche Kalender sollen in der App erscheinen?</div>
          <div className="list">
            {calendars.map((c, i) => (
              <div key={c.href} className="list-row" style={{ flexWrap: "wrap" }}>
                <span className="area-dot" style={{ background: c.color ?? "var(--text-faint)" }} />
                <span className="grow strong">{c.name}{c.readOnly ? " (nur lesen)" : ""}</span>
                <Segmented<Area>
                  value={c.area}
                  onChange={(v) => setCalendars(calendars.map((x, j) => (j === i ? { ...x, area: v } : x)))}
                  options={[{ value: "privat", label: "Privat" }, { value: "beruflich", label: "Beruflich" }]}
                />
                <button
                  type="button"
                  className={`switch ${c.sync ? "on" : ""}`}
                  aria-label={`${c.name} anzeigen`}
                  role="switch"
                  aria-checked={c.sync}
                  onClick={() => setCalendars(calendars.map((x, j) => (j === i ? { ...x, sync: !x.sync } : x)))}
                />
              </div>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Neue private Termine in">
              <select className="select" value={writePrivat} onChange={(e) => setWritePrivat(e.target.value)}>
                {writable.map((c) => <option key={c.href} value={c.href}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Neue berufliche Termine in">
              <select className="select" value={writeBeruflich} onChange={(e) => setWriteBeruflich(e.target.value)}>
                {writable.map((c) => <option key={c.href} value={c.href}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Button variant="primary" loading={busy === "save"} onClick={save}>Speichern und abgleichen</Button>
        </>
      )}

      {connection && (
        <div className="row wrap">
          <Button size="sm" icon={<RefreshCw size={15} />} loading={busy === "sync"} onClick={sync}>Jetzt abgleichen</Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={15} />} loading={busy === "delete"} onClick={remove}>Trennen</Button>
        </div>
      )}
    </div>
  );
}

function FeedCard() {
  const { settings, demo } = useApp();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const url = `${SUPABASE_URL}/functions/v1/calendar-feed?token=${settings.ics_token}`;
  const webcal = url.replace(/^https:/, "webcal:");
  return (
    <Card title="Alternative: Kalender-Abo" icon={<Link2 size={18} />}>
      <div className="stack">
        <p className="small muted">
          Ohne iCloud-Verbindung kannst du die App-Termine auch als Abo in jeden Kalender holen (Termine lassen sich dann nur in der App ändern). Der Link
          ist geheim – teile ihn nicht.
        </p>
        <Toggle checked={show} onChange={setShow} label="Abo-Link anzeigen" />
        {show && !demo && (
          <>
            <span className="kbd">{url}</span>
            <div className="row wrap">
              <a className="btn btn-primary btn-sm" href={webcal}><Smartphone size={15} /> Auf diesem iPhone abonnieren</a>
              <Button size="sm" icon={<Copy size={15} />} onClick={() => navigator.clipboard.writeText(url).then(() => toast.show("Link kopiert"))}>Kopieren</Button>
            </div>
          </>
        )}
        {show && demo && <Notice>Im Demo-Modus gibt es keinen Abo-Link.</Notice>}
      </div>
    </Card>
  );
}
