import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Tells every view that uses one of these tables to reload. */
export function invalidate(...keys: string[]): void {
  for (const key of keys) listeners.get(key)?.forEach((fn) => fn());
}

export interface LiveState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads data and reloads it whenever one of the given tables changes. */
export function useLive<T>(keys: string[], loader: () => Promise<T>, deps: unknown[] = []): LiveState<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({
    data: undefined,
    loading: true,
    error: null,
  });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const run = useRef(0);

  const reload = useCallback(async () => {
    const current = ++run.current;
    try {
      const data = await loaderRef.current();
      if (current === run.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (current === run.current) {
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
      }
    }
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const keyString = keys.join("|");
  useEffect(() => {
    const fn = () => void reload();
    const list = keyString.split("|").filter(Boolean);
    for (const k of list) {
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k)!.add(fn);
    }
    return () => list.forEach((k) => listeners.get(k)?.delete(fn));
  }, [keyString, reload]);

  return { ...state, reload };
}

/** Forwards database changes from other devices (realtime) to the views. */
export function useRealtime(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    const unsubscribe = db().subscribe((table) => {
      pending.add(table);
      clearTimeout(timer);
      timer = setTimeout(() => {
        invalidate(...pending);
        pending.clear();
      }, 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);
}

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [key],
  );
  return [value, update];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
