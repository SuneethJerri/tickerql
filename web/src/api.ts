/** Typed client for the analytics API.
 *
 * Types mirror api/src/app/models.py. They are hand-written rather than
 * generated: the surface is small and stable, and a generation step would be
 * one more thing to keep running. If the API's models change, these change.
 */

const BASE = import.meta.env.VITE_API_BASE ?? "";

export interface Asset {
  ticker: string;
  name: string;
  asset_type: "stock" | "crypto";
  sector: string;
  currency: string;
  bar_count: number;
  first_date: string | null;
  last_date: string | null;
}

export interface PriceBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adj_close: number | null;
  volume: number | null;
}

export interface PriceSeries {
  ticker: string;
  bars: PriceBar[];
}

export interface SectorPerformance {
  sector: string;
  start_date: string;
  end_date: string;
  observations: number;
  asset_count: number;
  total_return: number | null;
  annualized_return: number | null;
  annualized_volatility: number | null;
  return_per_unit_risk: number | null;
}

export interface SectorIndexPoint {
  sector: string;
  date: string;
  equal_weighted_return: number | null;
  indexed_value: number;
}

export interface RiskMetric {
  ticker: string;
  name: string;
  sector: string;
  asset_type: "stock" | "crypto";
  observations: number;
  start_date: string;
  end_date: string;
  total_return: number | null;
  annualized_return: number | null;
  annualized_volatility: number | null;
  return_per_unit_risk: number | null;
  max_drawdown: number | null;
  avg_volume: number | null;
  volatility_rank: number;
}

export interface CorrelationCell {
  ticker_a: string;
  ticker_b: string;
  correlation: number | null;
  observations: number;
}

export interface CorrelationMatrix {
  window_days: number;
  tickers: string[];
  cells: CorrelationCell[];
}

export interface MovingAveragePoint {
  date: string;
  close: number;
  window_size: number;
  avg_close: number;
  bars_used: number;
  is_partial: boolean;
}

export interface MovingAverageSeries {
  ticker: string;
  windows: number[];
  points: MovingAveragePoint[];
}

export interface QueryAttempt {
  sql: string;
  accepted: boolean;
  rejection: string | null;
  error: string | null;
  row_count: number | null;
  elapsed_ms: number | null;
}

export interface QueryResponse {
  question: string;
  answer: string;
  sql: string | null;
  columns: string[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  attempts: QueryAttempt[];
  model: string;
  model_calls: number;
  elapsed_ms: number;
  usage: Record<string, number>;
}

export interface Health {
  status: "ok" | "degraded";
  database: boolean;
  asset_count: number | null;
  price_rows: number | null;
  latest_bar: string | null;
  stale_days: number | null;
  detail: string | null;
}

/** Thrown for a non-2xx response, carrying the API's own `detail` message.
 *  The API writes those for humans (e.g. listing valid tickers on a 404), so
 *  surfacing it beats a generic "request failed". */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = body.detail[0].msg;
    } catch {
      /* non-JSON error body; keep the status line */
    }
    throw new ApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>("/api/health"),
  assets: () => request<Asset[]>("/api/assets"),
  prices: (ticker: string, start?: string) =>
    request<PriceSeries>(`/api/prices/${encodeURIComponent(ticker)}${start ? `?start=${start}` : ""}`),
  sectorPerformance: (window: number) =>
    request<SectorPerformance[]>(`/api/analytics/sector-performance?window=${window}`),
  sectorIndex: (window: number) =>
    request<SectorIndexPoint[]>(`/api/analytics/sector-index?window=${window}`),
  riskReturn: (window: number) =>
    request<RiskMetric[]>(`/api/analytics/risk-return?window=${window}`),
  volatility: (window: number) =>
    request<RiskMetric[]>(`/api/analytics/volatility?window=${window}`),
  correlation: (window: number, tickers?: string[]) =>
    request<CorrelationMatrix>(
      `/api/analytics/correlation?window=${window}` +
        (tickers?.length ? `&tickers=${tickers.join(",")}` : ""),
    ),
  movingAverages: (ticker: string, windows: number[], window: number) =>
    request<MovingAverageSeries>(
      `/api/analytics/moving-averages/${encodeURIComponent(ticker)}` +
        `?windows=${windows.join(",")}&window=${window}`,
    ),
  query: (question: string) =>
    request<QueryResponse>("/api/query", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
};

/** Formatting helpers. Returns and drawdowns arrive as fractions. */
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
export const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : v.toFixed(digits);
export const fmtCompact = (v: number | null | undefined) =>
  v == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
