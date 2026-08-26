import type { Asset } from "./api";

/** Everything the palette can take you to.
 *
 * The universe is 135 assets across 19 sectors behind a `<select>`, which is
 * the wrong control for that many things: you cannot type at it, and finding
 * NVDA means scrolling past a hundred rows you did not want. This is the
 * control for a list that size.
 */
export interface Command {
  /** Stable identity, unique across kinds - a sector and a ticker can collide
   *  on text but never on this. */
  id: string;
  kind: "view" | "asset" | "sector";
  /** What you match against and what is shown large. */
  label: string;
  /** Shown quietly beside the label. Also matched, at a lower weight. */
  detail?: string;
  /** URL parameters to apply. `null` clears one. */
  params: Record<string, string | null>;
}

export const VIEW_COMMANDS: Command[] = [
  { id: "view:dashboard", kind: "view", label: "Dashboard", params: { tab: "dashboard" } },
  { id: "view:sector", kind: "view", label: "Sectors", detail: "all sectors", params: { tab: "sector", sector: null } },
  { id: "view:risk", kind: "view", label: "Risk vs return", params: { tab: "risk" } },
  { id: "view:correlation", kind: "view", label: "Correlation", params: { tab: "correlation" } },
  { id: "view:asset", kind: "view", label: "Asset", params: { tab: "asset" } },
  { id: "view:compare", kind: "view", label: "Compare", detail: "pinned assets", params: { tab: "compare" } },
  { id: "view:ask", kind: "view", label: "Ask", detail: "question to SQL", params: { tab: "ask" } },
];

/** The full command list for a given universe. */
export function buildCommands(assets: readonly Asset[]): Command[] {
  const sectors = [...new Set(assets.map((a) => a.sector))].sort();
  return [
    ...VIEW_COMMANDS,
    ...assets.map((a): Command => ({
      id: `asset:${a.ticker}`,
      kind: "asset",
      label: a.ticker,
      detail: a.name,
      params: { tab: "asset", ticker: a.ticker },
    })),
    ...sectors.map((s): Command => ({
      id: `sector:${s}`,
      kind: "sector",
      label: s,
      detail: "sector",
      params: { tab: "sector", sector: s },
    })),
  ];
}

/**
 * Rank commands against what has been typed.
 *
 * Deliberately not fuzzy subsequence matching. "AAPL" matching "Bank of
 * America Corporation" through scattered letters is the behaviour that makes
 * fuzzy finders feel arbitrary, and with 135 tickers of 2-5 characters it fires
 * constantly. This ranks by WHERE the match is instead, which is the thing that
 * actually predicts intent:
 *
 *   an exact label            NVDA -> NVDA
 *   a label prefix            NV   -> NVDA
 *   a word start in the name  app  -> Apple Inc.
 *   anywhere in the name      onal -> ConocoPhillips
 *
 * Ties break towards views over assets over sectors, then alphabetically, so
 * the order is stable rather than dependent on the input array.
 */
export function rankCommands(commands: readonly Command[], query: string, limit = 12): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // An empty box offers the views. Offering 135 assets in source order is
    // offering nothing - the first screenful would be whatever the API
    // happened to return first.
    return commands.filter((c) => c.kind === "view").slice(0, limit);
  }

  const KIND_ORDER = { view: 0, asset: 1, sector: 2 } as const;
  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const label = command.label.toLowerCase();
    const detail = (command.detail ?? "").toLowerCase();
    let score = -1;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (startsWord(detail, q)) score = 60;
    else if (label.includes(q)) score = 40;
    else if (detail.includes(q)) score = 20;
    if (score < 0) continue;
    // A short label matching is a better signal than a long one: "co" hitting
    // COP means more than "co" hitting "Communication Services".
    scored.push({ command, score: score - Math.min(label.length, 20) / 100 });
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    KIND_ORDER[a.command.kind] - KIND_ORDER[b.command.kind] ||
    a.command.label.localeCompare(b.command.label));
  return scored.slice(0, limit).map((s) => s.command);
}

/** True when `q` starts any word in `text`. */
function startsWord(text: string, q: string): boolean {
  if (text.startsWith(q)) return true;
  for (const separator of [" ", "-", "."]) {
    if (text.includes(`${separator}${q}`)) return true;
  }
  return false;
}
