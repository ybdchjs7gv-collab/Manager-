import { Brain, Briefcase, CalendarDays, CheckSquare, ChefHat, Coffee, Dumbbell, Home, ShoppingCart } from "lucide-react";
import type { EventKind } from "../lib/types";

const ICONS: Record<string, typeof CalendarDays> = {
  termin: CalendarDays,
  aufgabe: CheckSquare,
  sport: Dumbbell,
  kochen: ChefHat,
  haushalt: Home,
  einkauf: ShoppingCart,
  fokus: Brain,
  pause: Coffee,
  sonstiges: Briefcase,
};

export const KIND_LABELS: Record<EventKind, string> = {
  termin: "Termin",
  aufgabe: "Aufgabe",
  sport: "Sport",
  kochen: "Kochen",
  haushalt: "Haushalt",
  einkauf: "Einkauf",
  fokus: "Fokuszeit",
  pause: "Pause",
  sonstiges: "Sonstiges",
};

const COLORED = new Set(["termin", "aufgabe", "sport", "kochen", "haushalt", "einkauf", "fokus"]);

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = ICONS[kind] ?? CalendarDays;
  return (
    <span className="kind-icon" style={{ background: `var(--k-${COLORED.has(kind) ? kind : "aufgabe"})` }}>
      <Icon size={size} />
    </span>
  );
}
