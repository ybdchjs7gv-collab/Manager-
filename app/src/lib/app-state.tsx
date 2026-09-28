import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { db } from "./db";
import { useLocalStorage } from "./hooks";
import type { PlannerSettings } from "./planner";
import type { AreaFilter, Settings } from "./types";

interface AppState {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  area: AreaFilter;
  setArea: (area: AreaFilter) => void;
  demo: boolean;
  userEmail: string | null;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppStateProvider({
  initialSettings,
  demo,
  userEmail,
  signOut,
  children,
}: {
  initialSettings: Settings;
  demo: boolean;
  userEmail: string | null;
  signOut: () => Promise<void>;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [area, setArea] = useLocalStorage<AreaFilter>("manager.area", "alle");
  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    const saved = await db().saveSettings(patch);
    setSettings(saved);
  }, []);
  const value = useMemo(
    () => ({ settings, saveSettings, area, setArea, demo, userEmail, signOut }),
    [settings, saveSettings, area, setArea, demo, userEmail, signOut],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppStateProvider fehlt");
  return ctx;
}

/** Filters a list by the global Privat/Beruflich switch. */
export function useAreaFilter<T extends { area: string | null }>(items: T[] | undefined): T[] {
  const { area } = useApp();
  return useMemo(() => (items ?? []).filter((i) => area === "alle" || !i.area || i.area === area), [items, area]);
}

export function plannerSettings(s: Settings): PlannerSettings {
  return {
    dayStart: s.day_start,
    dayEnd: s.day_end,
    workDays: s.work_days,
    workStart: s.work_start,
    workEnd: s.work_end,
    lunchStart: s.lunch_start,
    lunchMinutes: s.lunch_minutes,
    dinnerTime: s.dinner_time,
    bufferMinutes: s.buffer_minutes,
    maxBlockMinutes: s.max_block_minutes,
    workoutTime: s.preferences.workout_time ?? "abends",
    choreTime: s.preferences.chore_time ?? "abends",
    flexMinutesWorkday: s.preferences.flex_minutes_workday ?? 120,
    flexMinutesFreeDay: s.preferences.flex_minutes_freeday ?? 240,
  };
}
