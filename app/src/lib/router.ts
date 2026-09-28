import { useEffect, useState } from "react";

function current(): string[] {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState<string[]>(current);
  useEffect(() => {
    const onChange = () => {
      setRoute(current());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  const target = `#/${path.replace(/^\/+/, "")}`;
  if (window.location.hash !== target) window.location.hash = target;
}

export function href(path: string): string {
  return `#/${path.replace(/^\/+/, "")}`;
}

export function queryParam(name: string): string | null {
  const q = window.location.hash.split("?")[1];
  return q ? new URLSearchParams(q).get(name) : null;
}
