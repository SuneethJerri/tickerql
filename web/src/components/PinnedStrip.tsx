import { useQuery } from "@tanstack/react-query";
import { api, fmtPct, type RiskMetric, type SparklineSeries } from "../api";
import type { ThemeName } from "../charts/palette";
import { Sparkline } from "../charts/Sparkline";
import type { Pins } from "../pins";
import { setUrlParams } from "../urlState";

/** The pinned watchlist, above everything else on the dashboard.
 *
 * It reuses the two queries the risk table already makes, under the same keys,
 * so the strip costs no extra request. That is also why it takes the window:
 * pinning is not a separate timeframe.
 *
 * Empty renders nothing. An empty-state panel saying "pin something" would sit
 * at the top of the page permanently for everyone who never pins.
 */
export function PinnedStrip({
  pins, windowDays, theme,
}: {
  pins: Pins;
  windowDays: number;
  theme: ThemeName;
}) {
  const risk = useQuery({
    queryKey: ["risk-return", windowDays],
    queryFn: () => api.riskReturn(windowDays),
    enabled: pins.pins.length > 0,
  });
  const sparks = useQuery({
    queryKey: ["sparklines", windowDays],
    queryFn: () => api.sparklines(windowDays),
    enabled: pins.pins.length > 0,
  });

  if (!pins.pins.length) return null;

  const byTicker = new Map<string, RiskMetric>(
    (risk.data ?? []).map((r) => [r.ticker, r]),
  );
  const spark = new Map<string, SparklineSeries>(
    (sparks.data ?? []).map((s) => [s.ticker, s]),
  );

  return (
    <section className="card pinned" aria-label="Pinned assets">
      <h2>Pinned</h2>
      <div className="pin-row">
        {pins.pins.map((t) => {
          const r = byTicker.get(t);
          const s = spark.get(t);
          const ret = r?.total_return ?? null;
          return (
            <button
              key={t}
              type="button"
              className="pin-card"
              // Clicking a pinned asset goes to its detail view. Both params in
              // one entry so Back returns to the dashboard, not to a half-set
              // state the reader never saw.
              onClick={() => setUrlParams({ tab: "asset", ticker: t }, "push")}
              title={r ? `${r.name} — open ${t}` : `Open ${t}`}
            >
              <span className="pin-ticker">{t}</span>
              {s ? (
                <Sparkline closes={s.closes} theme={theme} width={84} height={22} />
              ) : (
                <span className="muted">—</span>
              )}
              <span
                className={`pin-delta ${ret == null ? "" : ret >= 0 ? "up" : "down"}`}
              >
                {ret == null ? "—" : fmtPct(ret)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pin-actions">
        <button className="table-toggle" onClick={() => pins.clear()}>
          Clear pins
        </button>
        {pins.pins.length > 1 && (
          <button
            className="table-toggle"
            onClick={() => setUrlParams({ tab: "compare" }, "push")}
          >
            Compare these {pins.pins.length}
          </button>
        )}
      </div>
    </section>
  );
}
