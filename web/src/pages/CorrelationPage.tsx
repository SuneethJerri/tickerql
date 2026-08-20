import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { CorrelationHeatmap } from "../charts/CorrelationHeatmap";
import { SECTOR_ORDER, type Mode } from "../charts/palette";
import { Card, ErrorNotice, Loading, WindowPicker } from "../components/ui";

export function CorrelationPage({ mode }: { mode: Mode }) {
  const [window, setWindow] = useState(365);
  const matrix = useQuery({
    queryKey: ["correlation", window],
    queryFn: () => api.correlation(window),
  });
  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });

  // Order the axes by sector, not alphabetically. A correlation matrix earns
  // its keep by showing block structure — the crypto cluster, the energy
  // cluster — and alphabetical order scatters those blocks across the grid so
  // the reader has to hunt for what the chart exists to show.
  const ordered = useMemo(() => {
    if (!matrix.data) return null;
    const sectorOf = new Map((assets.data ?? []).map((a) => [a.ticker, a.sector]));
    const rank = (t: string) => {
      const i = SECTOR_ORDER.indexOf(sectorOf.get(t) as never);
      return i >= 0 ? i : SECTOR_ORDER.length;
    };
    const tickers = [...matrix.data.tickers].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b),
    );
    return { ...matrix.data, tickers };
  }, [matrix.data, assets.data]);

  return (
    <>
      <div className="controls">
        <WindowPicker value={window} onChange={setWindow} options={[
          { value: 90, label: "90d" },
          { value: 365, label: "1y" },
          { value: 1095, label: "3y" },
        ]} />
      </div>

      <Card
        title="Correlation of daily returns"
        subtitle="Ordered by sector so the blocks are visible. Cross-asset pairs use only the days both assets traded — crypto trades weekends and equities do not, so padding would drag every crypto/equity pair toward zero."
      >
        {matrix.isPending ? <Loading height={420} /> : matrix.error ? <ErrorNotice error={matrix.error} /> : (
          <CorrelationHeatmap matrix={ordered ?? matrix.data!} mode={mode} />
        )}
      </Card>
    </>
  );
}
