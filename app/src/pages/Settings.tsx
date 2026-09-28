import { Bot, CalendarDays, ChevronLeft, ChevronRight, Clock, Mail, Smartphone, User, Zap } from "lucide-react";
import { PageHeader } from "../components/Layout";
import { AccountsSettings } from "../components/settings/Accounts";
import { CalendarSettings } from "../components/settings/CalendarSettings";
import { AiSettings, AppSettings, AutomationSettings, ProfileSettings, RoutineSettings } from "../components/settings/OtherSettings";
import { Card } from "../components/ui";
import { href } from "../lib/router";

const SECTIONS = [
  { id: "konten", label: "E-Mail-Postfächer", hint: "T-Online, GMX, WEB.DE, iCloud", icon: Mail, render: () => <AccountsSettings /> },
  { id: "kalender", label: "iPhone-Kalender", hint: "Termine automatisch eintragen", icon: CalendarDays, render: () => <CalendarSettings /> },
  { id: "ki", label: "KI", hint: "Claude-Schlüssel und Modelle", icon: Bot, render: () => <AiSettings /> },
  { id: "automatik", label: "Automatik", hint: "Newsletter löschen, Termine eintragen", icon: Zap, render: () => <AutomationSettings /> },
  { id: "tagesablauf", label: "Tagesablauf", hint: "Arbeitszeiten, Essen, Vorlieben", icon: Clock, render: () => <RoutineSettings /> },
  { id: "profil", label: "Profil", hint: "Name, WhatsApp-Name", icon: User, render: () => <ProfileSettings /> },
  { id: "app", label: "App & Konto", hint: "Installieren, Abmelden", icon: Smartphone, render: () => <AppSettings /> },
];

export function SettingsPage({ route }: { route: string[] }) {
  const section = SECTIONS.find((s) => s.id === route[0]);
  if (section) {
    return (
      <div>
        <a href={href("einstellungen")} className="btn btn-ghost btn-sm" style={{ marginLeft: -8, marginBottom: 4 }}>
          <ChevronLeft size={17} /> Einstellungen
        </a>
        <PageHeader title={section.label} area={false} />
        {section.render()}
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Einstellungen" area={false} />
      <Card padded={false}>
        <div className="list">
          {SECTIONS.map((s) => (
            <a key={s.id} className="list-row clickable" href={href(`einstellungen/${s.id}`)} style={{ textDecoration: "none" }}>
              <span className="kind-icon" style={{ background: "var(--surface-3)", color: "var(--text)" }}><s.icon size={17} /></span>
              <div className="grow stack tight" style={{ gap: 1 }}>
                <span className="strong">{s.label}</span>
                <span className="small muted">{s.hint}</span>
              </div>
              <ChevronRight size={18} className="faint" />
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
