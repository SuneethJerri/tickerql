import { useCallback, useSyncExternalStore } from "react";

/** View state in the URL instead of in `useState`, so a view is a link and the
 *  back button works. It is also what lets the screenshot harness point at a
 *  view by URL rather than clicking a nav button by its label.
 *
 * `useSyncExternalStore` rather than a context: the store is the address bar,
 * which is already global. The snapshot is the search string - a primitive, so
 * a write that changes nothing re-renders nothing.
 */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // popstate covers the back/forward buttons; `notify` covers our own writes,
  // because pushState and replaceState deliberately do not fire it.
  window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function getSnapshot(): string {
  return window.location.search;
}

/** Whether a change is worth a back-button stop.
 *
 * "push" for a change of view - a different tab, a drill-down - because that is
 * what a reader expects `back` to undo. "replace" for refining the current view,
 * so that flicking 30d/90d/365d does not bury the previous tab under three
 * history entries. */
export type HistoryMode = "push" | "replace";

function write(updates: Record<string, string | null>, mode: HistoryMode): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  notify();
}

/** Set several params in one history entry.
 *
 * Two `write` calls would leave a history entry in between with only half the
 * change applied - visible as a back button that lands on a state the user
 * never saw. The correlation drill-down sets two params and needs this. */
export function setUrlParams(
  updates: Record<string, string | null>,
  mode: HistoryMode = "push",
): void {
  write(updates, mode);
}

function useSearch(): URLSearchParams {
  return new URLSearchParams(useSyncExternalStore(subscribe, getSnapshot, () => ""));
}

/** A param constrained to a known set. Anything else falls back, so a
 *  hand-edited `?tab=nonsense` renders the default rather than a blank page. */
export function useUrlEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
  mode: HistoryMode = "push",
): [T, (next: T) => void] {
  const raw = useSearch().get(key);
  const value = allowed.includes(raw as T) ? (raw as T) : fallback;
  const set = useCallback(
    // The default is left out of the URL entirely: a link should carry what
    // was chosen, not a full dump of every default.
    (next: T) => write({ [key]: next === fallback ? null : next }, mode),
    [key, fallback, mode],
  );
  return [value, set];
}

export function useUrlNumber(
  key: string,
  allowed: readonly number[],
  fallback: number,
  mode: HistoryMode = "push",
): [number, (next: number) => void] {
  const raw = useSearch().get(key);
  const parsed = raw == null ? Number.NaN : Number(raw);
  const value = allowed.includes(parsed) ? parsed : fallback;
  const set = useCallback(
    (next: number) => write({ [key]: next === fallback ? null : String(next) }, mode),
    [key, fallback, mode],
  );
  return [value, set];
}

/** A free-text param - a ticker, a sector name. There is no allowlist to check
 *  it against on the client, so it is only length-capped here; an unknown
 *  ticker already gets a 404 that names the valid ones. */
export function useUrlString(
  key: string,
  fallback: string,
  mode: HistoryMode = "push",
  maxLength = 64,
): [string, (next: string) => void] {
  const raw = useSearch().get(key);
  const value = raw != null && raw.length > 0 && raw.length <= maxLength ? raw : fallback;
  const set = useCallback(
    (next: string) => write({ [key]: next === fallback ? null : next }, mode),
    [key, fallback, mode],
  );
  return [value, set];
}

/** Read one param without a fallback, for state that is genuinely optional. */
export function useUrlOptional(key: string, maxLength = 64): string | null {
  const raw = useSearch().get(key);
  return raw != null && raw.length > 0 && raw.length <= maxLength ? raw : null;
}
