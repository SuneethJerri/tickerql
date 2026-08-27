import type { ReactNode } from "react";
import { ApiError } from "../api";

export function Card({
  title, subtitle, action, children,
}: {
  title: string;
  subtitle?: string;
  /** Sits on the heading rule, right-aligned. For controls that act on the
   *  whole section - "Ask about this", an export - rather than on one row. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {action}
      </div>
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
 * The backend writes these for people - a 404 on an unknown ticker lists the
 * valid ones - so replacing it with "Something went wrong" throws away the
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
      <div>{message}</div>
      {/* The hint has to differ by build. This said "Is the API running?
          uvicorn app.main:app --reload" everywhere, including production,
          where it is advice about a machine the reader does not have - and it
          misdirected the one real outage we have had for about forty minutes,
          because it names a cause that is impossible on a deployed page. In
          production the same symptom has a different likely cause and a
          different useful action. */}
      {offline &&
        (import.meta.env.DEV ? (
          <div className="hint muted">
            Is the API running? <code>uvicorn app.main:app --reload</code>
          </div>
        ) : (
          <div className="hint muted">
            The API sleeps after a spell with no traffic and takes about a
            minute to wake. Reloading shortly usually works.
          </div>
        ))}
    </div>
  );
}

const WINDOWS = [
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
  { value: 365, label: "1y" },
];

export const CORRELATION_WINDOW_OPTIONS = [
  { value: 90, label: "90d" },
  { value: 365, label: "1y" },
  { value: 1095, label: "3y" },
];

/** The windows `market.asset_metrics` is materialized for. Exported so the URL
 *  reader and the picker cannot disagree about what is selectable - a `window`
 *  param the picker cannot show would leave the control lying about the view. */
export const METRIC_WINDOWS = WINDOWS.map((w) => w.value);
export const CORRELATION_WINDOWS = CORRELATION_WINDOW_OPTIONS.map((w) => w.value);

/** Trailing windows for the rolling-correlation series, in shared trading days.
 *  Which of them are offered depends on the span: a 90-day window over a
 *  90-day span is one point, not a series. */
export const ROLLING_WINDOW_OPTIONS = [
  { value: 30, label: "30d" },
  { value: 60, label: "60d" },
  { value: 90, label: "90d" },
];
export const ROLLING_WINDOWS = ROLLING_WINDOW_OPTIONS.map((w) => w.value);

/** Filters live in one row above the charts. */
export function WindowPicker({
  value, onChange, options = WINDOWS, label = "Window",
}: {
  value: number;
  onChange: (v: number) => void;
  options?: { value: number; label: string }[];
  label?: string;
}) {
  return (
    <span className="control">
      {label}
      <span className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </span>
    </span>
  );
}
