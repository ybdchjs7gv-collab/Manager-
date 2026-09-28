import { Check as CheckIcon, Info, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WEEKDAY_LABELS } from "../lib/dates";
import type { Area } from "../lib/types";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size,
  icon,
  loading,
  block,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm";
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", block ? "btn-block" : "", !children ? "btn-icon" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
}

export function Card({
  title,
  icon,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? "" : "pad-0"} ${className}`}>
      {(title || action) && (
        <div className="card-head" style={padded ? undefined : { padding: "14px 16px 0" }}>
          <h2 className="card-title">
            {icon}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone, children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

export function AreaBadge({ area }: { area: Area | null | undefined }) {
  if (!area) return null;
  return <Badge tone={area}>{area === "privat" ? "Privat" : "Beruflich"}</Badge>;
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="chips" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`chip ${o.value === value ? "active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  full,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`segmented ${full ? "full" : ""}`}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="row between" style={{ padding: "8px 0", gap: 16 }}>
      <div className="stack tight grow">
        <span style={{ fontWeight: 550 }}>{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="sr-only">{label}</span>
      </button>
    </div>
  );
}

export function Check({ done, onToggle, square, label }: { done: boolean; onToggle: () => void; square?: boolean; label: string }) {
  return (
    <button
      type="button"
      className={`check ${done ? "done" : ""} ${square ? "square" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={label}
      aria-pressed={done}
    >
      <CheckIcon size={15} strokeWidth={3} />
    </button>
  );
}

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  return (
    <div className="weekday-picker">
      {WEEKDAY_LABELS.map((label, i) => {
        const day = i + 1;
        const active = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            className={active ? "active" : ""}
            aria-pressed={active}
            onClick={() => onChange(active ? value.filter((d) => d !== day) : [...value, day].sort())}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <Button variant="ghost" icon={<X size={20} />} onClick={onClose} aria-label="Schließen" />
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="icon">{icon}</div>}
      <div className="title">{title}</div>
      {text && <div className="small">{text}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack tight" aria-busy="true" aria-label="Lädt">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}

export function Notice({ tone, children, icon }: { tone?: "warning" | "danger" | "success"; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`notice ${tone ?? ""}`}>
      {icon ?? <Info size={17} />}
      <div className="grow">{children}</div>
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <Notice tone="danger">{error}</Notice>;
}

// ---------------------------------------------------------------------------
// Meldungen (Toasts)
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  error?: boolean;
}

interface ToastApi {
  show: (text: string) => void;
  error: (err: unknown) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined, error: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, text, error }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), error ? 6000 : 3200);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    show: (text) => push(text),
    error: (err) => push(err instanceof Error ? err.message : String(err), true),
  }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.error ? "error" : ""}`} role={t.error ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** Runs an async action with loading state and error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const result = await fn();
        if (success) toast.show(success);
        return result;
      } catch (err) {
        toast.error(err);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}
