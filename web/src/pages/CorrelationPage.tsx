import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { CorrelationHeatmap, type HeatValue } from "../charts/CorrelationHeatmap";
import type { ChartBase } from "../charts/palette";
import { Card, ErrorNotice, Loading, WindowPicker } from "../components/ui";

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
export function CorrelationPage({ mode }: { mode: ChartBase }) {
  const [window, setWindow] = useState(365);
  const [drill, setDrill] = useState<[string, string] | null>(null);

  const matrix = useQuery({
    queryKey: ["correlation", window],
    queryFn: () => api.correlation(window),
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
    if (!model || !drill) return null;
    const [a, b] = drill;
    const tickers = new Set([
      ...(model.tickersBySector.get(a) ?? []),
      ...(model.tickersBySector.get(b) ?? []),
    ]);
    return [...tickers].sort();
  }, [model, drill]);

  return (
    <>
      <div className="controls">
        <WindowPicker value={window} onChange={setWindow} options={[
          { value: 90, label: "90d" },
          { value: 365, label: "1y" },
          { value: 1095, label: "3y" },
        ]} />
        {drill && (
          <button className="chip" onClick={() => setDrill(null)}>
            ← All sectors
          </button>
        )}
      </div>

      <Card
        title={
          drill
            ? drill[0] === drill[1]
              ? `Correlation within ${drill[0]}`
              : `Correlation: ${drill[0]} vs ${drill[1]}`
            : "Correlation of daily returns, by sector"
        }
        subtitle={
          drill
            ? "Every asset in the selected sectors, pair by pair."
            : "Each cell is the mean correlation across every asset pair spanning the two sectors, with self-pairs excluded. Click a cell to see the assets behind it. Cross-asset pairs use only the days both assets traded — crypto trades weekends and equities do not, so padding would drag every crypto/equity pair toward zero."
        }
      >
        {matrix.isPending || assets.isPending ? (
          <Loading height={420} />
        ) : matrix.error ? (
          <ErrorNotice error={matrix.error} />
        ) : !model ? null : drill && drillLabels ? (
          <CorrelationHeatmap
            labels={drillLabels}
            cellAt={(a, b) => model.pairs.get(`${a}|${b}`)}
            mode={mode}
            unit="shared days"
          />
        ) : (
          <CorrelationHeatmap
            labels={model.sectors}
            cellAt={(a, b) => model.sectorCells.get(`${a}|${b}`)}
            mode={mode}
            unit="pairs"
            onSelect={(a, b) => setDrill([a, b])}
          />
        )}
      </Card>
    </>
  );
}
