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

export interface SparklineSeries {
  ticker: string;
  start_date: string;
  end_date: string;
  /** Weekly closes. No per-point dates: a sparkline is shape over a stated span. */
  closes: number[];
}

export interface CorrelationCell {
  ticker_a: string;
  ticker_b: string;
  correlation: number | null;
  observations: number;
}

export interface SectorCorrelationCell {
  sector_a: string;
  sector_b: string;
  correlation: number | null;
  pairs: number;
  /** The strongest single asset pair spanning the two sectors. */
  top_ticker_a: string | null;
  top_ticker_b: string | null;
  top_correlation: number | null;
}

export interface SectorCorrelationMatrix {
  window_days: number;
  sectors: string[];
  cells: SectorCorrelationCell[];
}

export interface RollingCorrelationPoint {
  date: string;
  correlation: number | null;
  observations: number;
}

export interface RollingCorrelation {
  ticker_a: string;
  ticker_b: string;
  window_days: number;
  span_days: number;
  /** The single figure the heatmap shows for this pair over the same span. */
  span_correlation: number | null;
  points: RollingCorrelationPoint[];
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
  model_ms: number;
  usage: Record<string, number>;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

/** One progress report from POST /api/query/stream. These are the real
 *  boundaries of the agent loop, not a timer: `thinking` is a model call in
 *  flight, `guard` is the validator's verdict on a candidate statement. */
export type StreamEvent =
  | { phase: "accepted"; question: string }
  | { phase: "thinking"; call: number; of: number }
  | { phase: "thought"; call: number; ms: number; tool_calls: number }
  | { phase: "sql"; sql: string }
  | { phase: "guard"; ok: boolean; reason: string | null }
  | { phase: "executing"; sql: string }
  | { phase: "rows"; row_count: number; ms: number }
  | { phase: "sql_failed"; message: string }
  | { phase: "retrying"; reason: string }
  | { phase: "answering" }
  | { phase: "done"; result: QueryResponse }
  | { phase: "error"; status: number; detail: string };

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
  sparklines: (window: number) =>
    request<SparklineSeries[]>(`/api/analytics/sparklines?window=${window}`),
  volatility: (window: number) =>
    request<RiskMetric[]>(`/api/analytics/volatility?window=${window}`),
  correlation: (window: number, tickers?: string[]) =>
    request<CorrelationMatrix>(
      `/api/analytics/correlation?window=${window}` +
        (tickers?.length ? `&tickers=${tickers.join(",")}` : ""),
    ),
  correlationSectors: (window: number) =>
    request<SectorCorrelationMatrix>(
      `/api/analytics/correlation/sectors?window=${window}`,
    ),
  rollingCorrelation: (a: string, b: string, window: number, span: number) =>
    request<RollingCorrelation>(
      `/api/analytics/rolling-correlation?a=${encodeURIComponent(a)}` +
        `&b=${encodeURIComponent(b)}&window=${window}&span=${span}`,
    ),
  movingAverages: (ticker: string, windows: number[], window: number) =>
    request<MovingAverageSeries>(
      `/api/analytics/moving-averages/${encodeURIComponent(ticker)}` +
        `?windows=${windows.join(",")}&window=${window}`,
    ),
  query: (question: string, history: Turn[] = []) =>
    request<QueryResponse>("/api/query", {
      method: "POST",
      body: JSON.stringify({ question, history }),
    }),
  queryStream,
};

/** POST /api/query/stream, reported event by event.
 *
 * EventSource cannot do this: it is GET-only and cannot send a body, and the
 * question plus its history is a body. So the SSE framing is parsed by hand off
 * the fetch body reader - which is about fifteen lines and avoids inventing a
 * GET route that takes a conversation in the query string.
 *
 * Errors arrive two ways and both are mapped to ApiError, so a caller never has
 * to care which: as a status code before the stream opens (401, 429, 422, 503),
 * and as a terminal `error` event once it has (the model call failed, mid-way).
 */
async function queryStream(
  question: string,
  history: Turn[],
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  const response = await fetch(`${BASE}/api/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
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
  if (!response.body) throw new ApiError(502, "The server sent no response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // SSE frames are separated by a blank line and a frame can straddle two
  // chunks, so the tail stays buffered until its terminator arrives.
  let buffer = "";
  let result: QueryResponse | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split("\n")) {
        // Lines opening with ':' are comments — the keep-alive heartbeat.
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as StreamEvent;
        if (event.phase === "error") throw new ApiError(event.status, event.detail);
        if (event.phase === "done") result = event.result;
        onEvent(event);
      }
    }
  }

  if (!result) throw new ApiError(502, "The stream ended before an answer arrived.");
  return result;
}

/** Formatting helpers. Returns and drawdowns arrive as fractions. */
export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
export const fmtNum = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : v.toFixed(digits);
export const fmtCompact = (v: number | null | undefined) =>
  v == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);
