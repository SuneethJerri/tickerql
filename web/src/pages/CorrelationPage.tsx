import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { CorrelationHeatmap, type HeatValue } from "../charts/CorrelationHeatmap";
import { RollingCorrelationChart } from "../charts/RollingCorrelationChart";
import type { ThemeName } from "../charts/palette";
import { downloadCsv } from "../csv";
import {
  Card, ErrorNotice, Loading, WindowPicker,
  CORRELATION_WINDOWS, CORRELATION_WINDOW_OPTIONS,
  ROLLING_WINDOWS, ROLLING_WINDOW_OPTIONS,
} from "../components/ui";
import { AskAbout } from "../components/AskAbout";
import { setUrlParams, useUrlNumber, useUrlOptional } from "../urlState";

/** Correlation, sector-first.
 *
 * A ticker matrix is 135 x 135 = 18,225 cells and roughly 3,500 px tall. That
 * is not a chart; the column headers alone overprinted into one illegible run.
 * The sector matrix is 19 x 19 = 361 cells, fits on a screen, and shows the
 * block structure the chart exists for. Clicking a cell drills into the assets
 * behind it, which is where the ticker detail still belongs.
 *
 * A sector cell is the MEAN of the pairwise correlations behind it, not a
 * correlation of sector indices - averaging the pairs answers "do these two
 * groups move together", which is the question the grid is being read for.
 */
export function CorrelationPage({ theme }: { theme: ThemeName }) {
  const [windowDays, setWindow] = useUrlNumber(
    "window", CORRELATION_WINDOWS, 365, "replace",
  );
  // The drill-down is two params rather than one joined string: sector names
  // contain both spaces and colons ("India: Energy"), so any separator worth
  // picking is already inside the data.
  const drillA = useUrlOptional("sa");
  const drillB = useUrlOptional("sb");
  const drill: [string, string] | null = drillA && drillB ? [drillA, drillB] : null;
  // Pushed, not replaced: a drill-down is a change of view, and `back` should
  // return to the sector matrix. Both params move in one entry so `back` can
  // never land on a half-applied state the reader never saw.
  const setDrill = (next: [string, string] | null) =>
    setUrlParams(next ? { sa: next[0], sb: next[1] } : { sa: null, sb: null });

  // The pair the rolling series is drawn for. Replaced rather than pushed: it
  // is a filter on a card that is always on screen, not a change of view, and
  // pushing would make `back` walk through every pair the reader tried.
  const pinnedA = useUrlOptional("pa");
  const pinnedB = useUrlOptional("pb");
  const setPair = (a: string, b: string) => setUrlParams({ pa: a, pb: b }, "replace");
  const [rollingPref, setRolling] = useUrlNumber("rw", ROLLING_WINDOWS, 60, "replace");

  const matrix = useQuery({
    queryKey: ["correlation", windowDays],
    queryFn: () => api.correlation(windowDays),
  });
  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });

  const model = useMemo(() => {
    if (!matrix.data) return null;
    const sectorOf = new Map((assets.data ?? []).map((a) => [a.ticker, a.sector]));
    const pairs = new Map(
      matrix.data.cells.map((c) => [`${c.ticker_a}|${c.ticker_b}`, c]),
    );

    const sectors = [...new Set(matrix.data.tickers.map((t) => sectorOf.get(t) ?? "Unknown"))]
      .sort();
    const tickersBySector = new Map<string, string[]>();
    for (const ticker of [...matrix.data.tickers].sort()) {
      const sector = sectorOf.get(ticker) ?? "Unknown";
      tickersBySector.set(sector, [...(tickersBySector.get(sector) ?? []), ticker]);
    }

    // Mean over distinct pairs. The diagonal of the ticker matrix is 1.0 by
    // construction, so including a === b would pull every intra-sector cell
    // toward 1 by an amount that depends only on how many assets the sector
    // has - a pure artefact of sector size.
    const sectorCells = new Map<string, HeatValue>();
    for (const a of sectors) {
      for (const b of sectors) {
        let total = 0;
        let count = 0;
        for (const ta of tickersBySector.get(a) ?? []) {
          for (const tb of tickersBySector.get(b) ?? []) {
            if (ta === tb) continue;
            const value = pairs.get(`${ta}|${tb}`)?.correlation;
            if (value == null) continue;
            total += value;
            count += 1;
          }
        }
        sectorCells.set(`${a}|${b}`, {
          correlation: count ? total / count : null,
          observations: count,
        });
      }
    }

    return { sectors, tickersBySector, pairs, sectorCells };
  }, [matrix.data, assets.data]);

  const drillLabels = useMemo(() => {
    if (!model || !drillA || !drillB) return null;
    const tickers = new Set([
      ...(model.tickersBySector.get(drillA) ?? []),
      ...(model.tickersBySector.get(drillB) ?? []),
    ]);
    // A hand-typed ?sa=Nonsense selects nothing; fall back to the sector matrix
    // rather than rendering an empty grid.
    return tickers.size ? [...tickers].sort() : null;
  }, [model, drillA, drillB]);

  // A 30-day window over a 90-day span is thirty-odd points; a 90-day window
  // over the same span is one. Offer only the windows the span can carry, and
  // fall back to the widest that fits rather than fetching a series of length 1.
  const rollingOptions = ROLLING_WINDOW_OPTIONS.filter((o) => o.value * 2 <= windowDays);
  const rollingDays = rollingOptions.some((o) => o.value === rollingPref)
    ? rollingPref
    : (rollingOptions[rollingOptions.length - 1]?.value ?? 30);

  const tickers = matrix.data?.tickers ?? [];
  const known = (t: string | null) => (t && tickers.includes(t) ? t : null);

  // The default pair is the most correlated distinct pair in the matrix, not
  // the alphabetically first two. Taking tickers[0] and tickers[1] opened the
  // card on AAPL and ABBV - two names with no relationship, whose series is a
  // flat line at zero, which makes the chart look like it is not working.
  // Reading it off the matrix that is already loaded costs one pass and no
  // hardcoded tickers.
  const strongestPair = useMemo(() => {
    let best: { a: string; b: string; v: number } | null = null;
    for (const c of matrix.data?.cells ?? []) {
      if (c.ticker_a >= c.ticker_b || c.correlation == null) continue;
      if (!best || c.correlation > best.v) {
        best = { a: c.ticker_a, b: c.ticker_b, v: c.correlation };
      }
    }
    return best;
  }, [matrix.data]);

  const pairA = known(pinnedA) ?? strongestPair?.a ?? tickers[0] ?? null;
  const pairB = known(pinnedB) ?? strongestPair?.b ?? tickers[1] ?? null;

  const rolling = useQuery({
    queryKey: ["rolling-correlation", pairA, pairB, rollingDays, windowDays],
    queryFn: () => api.rollingCorrelation(pairA!, pairB!, rollingDays, windowDays),
    enabled: Boolean(pairA && pairB),
  });

  // The one sentence a matrix cell cannot say. Rendered from the series rather
  // than written into the subtitle, because it is the finding, not the caption.
  const swing = useMemo(() => {
    const values = (rolling.data?.points ?? [])
      .map((p) => p.correlation)
      .filter((v): v is number => v != null);
    if (values.length < 2) return null;
    return { low: Math.min(...values), high: Math.max(...values) };
  }, [rolling.data]);

  // The visible grid, long rather than wide: 361 sector cells or a ticker
  // block, one row per pair, which is the shape a spreadsheet can pivot.
  const exportPairs = () => {
    if (!model) return;
    const labels = drillLabels ?? model.sectors;
    const at = drillLabels
      ? (a: string, b: string) => model.pairs.get(`${a}|${b}`)
      : (a: string, b: string) => model.sectorCells.get(`${a}|${b}`);
    const rows = labels.flatMap((a) =>
      labels.map((b) => [a, b, at(a, b)?.correlation ?? null, at(a, b)?.observations ?? 0]),
    );
    downloadCsv(
      `tickerql-correlation-${drillLabels ? "assets" : "sectors"}-${windowDays}d`,
      [drillLabels ? "ticker_a" : "sector_a", drillLabels ? "ticker_b" : "sector_b",
       "correlation", drillLabels ? "shared_days" : "pairs"],
      rows,
    );
  };

  return (
    <>
      <div className="controls">
        <WindowPicker
          value={windowDays} onChange={setWindow} options={CORRELATION_WINDOW_OPTIONS}
        />
        {drill && drillLabels && (
          <button className="chip" onClick={() => setDrill(null)}>
            ← All sectors
          </button>
        )}
        <button className="chip" onClick={exportPairs} disabled={!model}>
          Download CSV
        </button>
      </div>

      <Card
        title={
          drill && drillLabels
            ? drill[0] === drill[1]
              ? `Correlation within ${drill[0]}`
              : `Correlation: ${drill[0]} vs ${drill[1]}`
            : "Correlation of daily returns, by sector"
        }
        subtitle={
          drill && drillLabels
            ? "Every asset in the selected sectors, pair by pair. Click a cell to draw that pair's correlation over time below."
            : "Each cell is the mean correlation across every asset pair spanning the two sectors, with self-pairs excluded. Click a cell to see the assets behind it. Cross-asset pairs use only the days both assets traded — crypto trades weekends and equities do not, so padding would drag every crypto/equity pair toward zero."
        }
      >
        {matrix.isPending || assets.isPending ? (
          <Loading height={420} />
        ) : matrix.error ? (
          <ErrorNotice error={matrix.error} />
        ) : !model ? null : drillLabels ? (
          <CorrelationHeatmap
            labels={drillLabels}
            cellAt={(a, b) => model.pairs.get(`${a}|${b}`)}
            theme={theme}
            unit="shared days"
            onSelect={setPair}
          />
        ) : (
          <CorrelationHeatmap
            labels={model.sectors}
            cellAt={(a, b) => model.sectorCells.get(`${a}|${b}`)}
            theme={theme}
            unit="pairs"
            onSelect={(a, b) => setDrill([a, b])}
          />
        )}
      </Card>

      <Card
        title={
          pairA && pairB
            ? `${pairA} and ${pairB}: correlation over time`
            : "Correlation over time"
        }
        subtitle={
          `Correlation over a trailing window of ${rollingDays} shared trading days, ` +
          "drawn on every date in the span. The dashed line is the single figure the " +
          "matrix above shows for this pair — a matrix cell is a mean, and a mean of " +
          "0.4 can be a pair that sat at 0.4 all year or one that spent half the span " +
          "at 0.8 and half at 0.0. Windows without a full set of observations behind " +
          "them are not drawn, so the left edge is as well-founded as the right."
        }
        action={
          pairA && pairB ? (
            <AskAbout
              question={`How has the correlation between ${pairA} and ${pairB} changed over the last ${windowDays} days, using a trailing ${rollingDays}-day window?`}
            />
          ) : undefined
        }
      >
        <div className="controls">
          <span className="control">
            Pair
            <select
              value={pairA ?? ""} aria-label="First ticker"
              onChange={(e) => setPair(e.target.value, pairB ?? "")}
            >
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={pairB ?? ""} aria-label="Second ticker"
              onChange={(e) => setPair(pairA ?? "", e.target.value)}
            >
              {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </span>
          {rollingOptions.length > 1 && (
            <WindowPicker
              value={rollingDays} onChange={setRolling} options={rollingOptions}
              label="Trailing"
            />
          )}
          {swing && (
            <span className="control muted">
              {swing.low.toFixed(2)} to {swing.high.toFixed(2)} across the span
            </span>
          )}
        </div>

        {rolling.isPending ? (
          <Loading height={260} />
        ) : rolling.error ? (
          <ErrorNotice error={rolling.error} />
        ) : !rolling.data?.points.length ? (
          <div className="hint muted">
            No window in this span has {rollingDays} shared trading days behind it.
          </div>
        ) : (
          <RollingCorrelationChart
            points={rolling.data.points}
            spanCorrelation={rolling.data.span_correlation}
            windowDays={rollingDays}
            theme={theme}
          />
        )}
      </Card>
    </>
  );
}
