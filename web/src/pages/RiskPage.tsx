import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, fmtCompact, fmtPct } from "../api";
import { RiskReturnScatter } from "../charts/RiskReturnScatter";
import { assetTypeColor, type ChartBase } from "../charts/palette";
import { TableView } from "../components/TableView";
import { Card, ErrorNotice, Loading, WindowPicker } from "../components/ui";

export function RiskPage({ mode }: { mode: ChartBase }) {
  const [window, setWindow] = useState(365);
  const risk = useQuery({
    queryKey: ["risk-return", window],
    queryFn: () => api.riskReturn(window),
  });

  return (
    <>
      <div className="controls">
        <WindowPicker value={window} onChange={setWindow} />
      </div>

      <Card
        title="Risk versus return"
        subtitle="Every tracked asset on one plane, coloured by equity versus crypto only. A scatter puts arbitrary pairs side by side, which caps it at three distinguishable hues — nowhere near the 19 sectors, so sector lives in the tooltip and the table instead."
      >
        {risk.isPending ? <Loading height={340} /> : risk.error ? <ErrorNotice error={risk.error} /> : (
          <>
            <RiskReturnScatter data={risk.data!} mode={mode} />
            <TableView
              label="asset table"
              columns={["Asset", "Sector", "Return", "Volatility", "Return / risk", "Max drawdown", "Avg volume"]}
              rows={(risk.data ?? []).map((r) => [
                <>
                  <span className="swatch" style={{ background: assetTypeColor(r.asset_type, mode) }} />
                  {r.ticker}
                </>,
                r.sector,
                fmtPct(r.annualized_return),
                fmtPct(r.annualized_volatility),
                r.return_per_unit_risk?.toFixed(2) ?? "—",
                fmtPct(r.max_drawdown),
                fmtCompact(r.avg_volume),
              ])}
            />
          </>
        )}
      </Card>
    </>
  );
}
