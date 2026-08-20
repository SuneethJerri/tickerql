import type { ReactNode } from "react";
import { ApiError } from "../api";

export function Card({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Loading({ height = 280 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} role="status" aria-label="Loading" />;
}

/** Surfaces the API's own message.
 *
 * The backend writes these for people — a 404 on an unknown ticker lists the
 * valid ones — so replacing it with "Something went wrong" throws away the
 * most useful part of the response.
 */
export function ErrorNotice({ error }: { error: unknown }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Unknown error";
  const offline = !(error instanceof ApiError);
  return (
    <div className="notice error">
      <strong>Could not load this view.</strong>
      <div style={{ marginTop: 4 }}>{message}</div>
      {offline && (
        <div style={{ marginTop: 8 }} className="muted">
          Is the API running? <code>uvicorn app.main:app --reload</code>
        </div>
      )}
    </div>
  );
}

const WINDOWS = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 365, label: "1y" },
];

/** Filters live in one row above the charts. */
export function WindowPicker({
  value, onChange, options = WINDOWS,
}: {
  value: number;
  onChange: (v: number) => void;
  options?: { value: number; label: string }[];
}) {
  return (
    <span className="control">
      Window
      <span className="segmented" role="group" aria-label="Time window">
        {options.map((o) => (
          <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}
