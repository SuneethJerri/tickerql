/** Pinned assets - a small watchlist that survives both a reload and a link.
 *
 * The URL is the source of truth, not localStorage: a watchlist that lives only
 * in a browser cannot be sent to anyone, and every other piece of view state is
 * already in the address bar.
 *
 * localStorage is the fallback, and only on a first visit with no `pins` in the
 * URL. Once a link carries pins the link wins, because someone opening a shared
 * watchlist expects to see that watchlist and not their own.
 */

import { useCallback } from "react";
import { setUrlParams, useUrlOptional } from "./urlState";

const KEY = "pins";
const STORE = "tickerql.pins";

/** Enough to compare, not enough to become a portfolio tool. The overlay chart
 *  caps at the 8 hues the categorical palette validates on the adjacent
 *  pairlist, and a pinned strip past that stops being scannable. */
export const MAX_PINS = 8;

/** Tickers are uppercase alphanumerics plus the dot in `RELIANCE.NS`. Anything
 *  else in a hand-edited URL is dropped rather than rendered: an unknown ticker
 *  would otherwise sit in the strip forever showing em dashes. */
const TICKER = /^[A-Z0-9.]{1,12}$/;

/** Exported for the tests: this is the half of pinning that has rules -
 *  everything a hand-edited or shared URL can put in front of it. */
export function parsePins(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim().toUpperCase();
    if (TICKER.test(t)) seen.add(t);
    if (seen.size >= MAX_PINS) break;
  }
  return [...seen];
}

function read(): string[] {
  try {
    return parsePins(window.localStorage.getItem(STORE));
  } catch {
    // Private windows and "block site data" both throw on access rather than
    // returning null, so this has to be a try/catch and not a null check.
    return [];
  }
}

function persist(pins: string[]): void {
  try {
    if (pins.length) window.localStorage.setItem(STORE, pins.join(","));
    else window.localStorage.removeItem(STORE);
  } catch {
    /* nothing to do: pins still work for this session, they just do not carry */
  }
}

export interface Pins {
  readonly pins: string[];
  readonly isPinned: (ticker: string) => boolean;
  readonly toggle: (ticker: string) => void;
  readonly clear: () => void;
  readonly full: boolean;
}

export function usePins(): Pins {
  const raw = useUrlOptional(KEY, MAX_PINS * 13);
  // `raw === null` means the URL says nothing about pins, which is different
  // from `?pins=` meaning "explicitly none" - the first restores the remembered
  // set, the second must stay empty or clearing pins would undo itself on the
  // next render.
  const pins = raw === null ? read() : parsePins(raw);

  const write = useCallback((next: string[]) => {
    persist(next);
    // "replace": pinning refines the current view. Pinning four assets should
    // not put four entries between the reader and the page they came from.
    setUrlParams({ [KEY]: next.length ? next.join(",") : "" }, "replace");
  }, []);

  const toggle = useCallback(
    (ticker: string) => {
      const t = ticker.toUpperCase();
      const has = pins.includes(t);
      if (!has && pins.length >= MAX_PINS) return;
      write(has ? pins.filter((p) => p !== t) : [...pins, t]);
    },
    [pins, write],
  );

  return {
    pins,
    isPinned: (t) => pins.includes(t.toUpperCase()),
    toggle,
    clear: () => write([]),
    full: pins.length >= MAX_PINS,
  };
}
