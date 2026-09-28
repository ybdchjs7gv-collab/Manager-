import { useCallback, useEffect, useRef, useState } from "react";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AppStateProvider } from "./lib/app-state";
import { setDemo } from "./lib/config";
import { initBackend, supabase } from "./lib/db";
import { useRealtime } from "./lib/hooks";
import { useRoute } from "./lib/router";
import type { Settings } from "./lib/types";
import { CalendarPage } from "./pages/Calendar";
import { LifePage } from "./pages/Life";
import { LoginPage } from "./pages/Login";
import { MessagesPage } from "./pages/Messages";
import { PlannerPage } from "./pages/Planner";
import { SettingsPage } from "./pages/Settings";
import { TodayPage } from "./pages/Today";

type Phase = { name: "loading" } | { name: "login" } | { name: "ready"; settings: Settings; email: string | null; demo: boolean } | { name: "error"; message: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const load = useCallback(async () => {
    try {
      const backend = await initBackend();
      if (backend.mode === "demo") {
        setPhase({ name: "ready", settings: await backend.getSettings(), email: null, demo: true });
        return;
      }
      const { data } = await supabase!.auth.getSession();
      if (!data.session) {
        setPhase({ name: "login" });
        return;
      }
      setPhase({ name: "ready", settings: await backend.getSettings(), email: data.session.user.email ?? null, demo: false });
    } catch (err) {
      setPhase({ name: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Supabase warns against awaiting its own calls inside this callback.
      if (event === "SIGNED_OUT") setTimeout(() => setPhase({ name: "login" }), 0);
      if (event === "SIGNED_IN" && phaseRef.current.name === "login") setTimeout(() => void load(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const signOut = useCallback(async () => {
    if (phase.name === "ready" && phase.demo) {
      setDemo(false);
      window.location.reload();
      return;
    }
    await supabase?.auth.signOut();
  }, [phase]);

  if (phase.name === "loading") {
    return (
      <div className="login-wrap">
        <span className="spinner" aria-label="Lädt" />
      </div>
    );
  }
  if (phase.name === "error") {
    return (
      <div className="login-wrap">
        <div className="card login-card stack">
          <h1 className="page-title">Verbindung fehlgeschlagen</h1>
          <p className="muted">{phase.message}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }
  if (phase.name === "login") {
    return (
      <ToastProvider>
        <LoginPage />
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <AppStateProvider initialSettings={phase.settings} demo={phase.demo} userEmail={phase.email} signOut={signOut}>
        <Shell />
      </AppStateProvider>
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();
  useRealtime(true);
  const [section, ...rest] = route;
  let page;
  switch (section) {
    case "nachrichten":
      page = <MessagesPage route={rest} />;
      break;
    case "kalender":
      page = <CalendarPage />;
      break;
    case "alltag":
      page = <LifePage route={rest} />;
      break;
    case "planer":
      page = <PlannerPage />;
      break;
    case "einstellungen":
      page = <SettingsPage route={rest} />;
      break;
    default:
      page = <TodayPage />;
  }
  return <Layout section={section ?? "heute"}>{page}</Layout>;
}
