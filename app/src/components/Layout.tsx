import { CalendarDays, Home, Inbox, LayoutGrid, Settings as SettingsIcon, Sparkles, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../lib/app-state";
import { db } from "../lib/db";
import { useLive } from "../lib/hooks";
import { href } from "../lib/router";
import type { AreaFilter } from "../lib/types";
import { Segmented } from "./ui";

const NAV = [
  { id: "heute", label: "Heute", icon: Home, path: "" },
  { id: "nachrichten", label: "Nachrichten", icon: Inbox, path: "nachrichten" },
  { id: "kalender", label: "Kalender", icon: CalendarDays, path: "kalender" },
  { id: "alltag", label: "Alltag", icon: LayoutGrid, path: "alltag" },
  { id: "einstellungen", label: "Mehr", icon: SettingsIcon, path: "einstellungen" },
];

function useInboxBadge(): number {
  const { data } = useLive(["emails"], () =>
    db().count("emails", [["status", "eq", "neu"], ["category", "notIn", ["newsletter", "werbung", "spam"]]])
  );
  return data ?? 0;
}

export function Layout({ section, children }: { section: string; children: ReactNode }) {
  const { demo } = useApp();
  const badge = useInboxBadge();
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Hauptmenü">
        <div className="brand">
          <div className="logo sm">
            <Sparkles size={17} />
          </div>
          Manager
        </div>
        {NAV.map((item) => (
          <a key={item.id} href={href(item.path)} className={`side-link ${section === item.id ? "active" : ""}`}>
            <item.icon size={19} />
            {item.id === "einstellungen" ? "Einstellungen" : item.label}
            {item.id === "nachrichten" && badge > 0 && <span className="count">{badge}</span>}
          </a>
        ))}
        <div className="side-section">Werkzeuge</div>
        <a href={href("planer")} className={`side-link ${section === "planer" ? "active" : ""}`}>
          <Wand2 size={19} />
          Tag planen
        </a>
        {demo && <div className="demo-banner" style={{ marginTop: "auto" }}>Demo-Modus</div>}
      </nav>

      <main className="main">
        {demo && <div className="demo-banner hide-desktop">Demo-Modus – Beispieldaten, nur auf diesem Gerät</div>}
        {children}
      </main>

      <nav className="tabbar" aria-label="Hauptmenü">
        {NAV.map((item) => (
          <a key={item.id} href={href(item.path)} className={`tab ${section === item.id ? "active" : ""}`}>
            <item.icon size={23} strokeWidth={section === item.id ? 2.3 : 1.8} />
            {item.label}
            {item.id === "nachrichten" && badge > 0 && <span className="dot">{badge > 99 ? "99+" : badge}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}

export function AreaSwitch() {
  const { area, setArea } = useApp();
  return (
    <Segmented<AreaFilter>
      value={area}
      onChange={setArea}
      options={[
        { value: "alle", label: "Alle" },
        { value: "privat", label: "Privat" },
        { value: "beruflich", label: "Beruflich" },
      ]}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  area = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  area?: boolean;
}) {
  return (
    <header className="stack" style={{ gap: 10, marginBottom: 16 }}>
      <div className="topbar" style={{ paddingBottom: 0 }}>
        <div className="grow">
          <h1 className="page-title">{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {area && (
        <div>
          <AreaSwitch />
        </div>
      )}
    </header>
  );
}
