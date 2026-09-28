import { HouseholdView } from "../components/life/Household";
import { MealsView } from "../components/life/Meals";
import { ShoppingView } from "../components/life/Shopping";
import { SportView } from "../components/life/Sport";
import { TasksView } from "../components/life/Tasks";
import { PageHeader } from "../components/Layout";
import { Chips } from "../components/ui";
import { navigate } from "../lib/router";

const TABS = [
  { value: "aufgaben", label: "Aufgaben" },
  { value: "einkauf", label: "Einkauf" },
  { value: "essen", label: "Essen" },
  { value: "sport", label: "Sport" },
  { value: "haushalt", label: "Haushalt" },
] as const;

type Tab = (typeof TABS)[number]["value"];

export function LifePage({ route }: { route: string[] }) {
  const tab: Tab = (TABS.find((t) => t.value === route[0])?.value ?? "aufgaben") as Tab;
  return (
    <div>
      <PageHeader title="Alltag" area={tab === "aufgaben"} />
      <div style={{ marginBottom: 16 }}>
        <Chips<Tab> value={tab} onChange={(v) => navigate(`alltag/${v}`)} options={TABS.map((t) => ({ value: t.value, label: t.label }))} />
      </div>
      {tab === "aufgaben" && <TasksView />}
      {tab === "einkauf" && <ShoppingView />}
      {tab === "essen" && <MealsView />}
      {tab === "sport" && <SportView />}
      {tab === "haushalt" && <HouseholdView />}
    </div>
  );
}
