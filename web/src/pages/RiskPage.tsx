import { useQuery } from "@tanstack/react-query";
import { api, fmtCompact, fmtPct, type RiskMetric } from "../api";
import { RiskReturnScatter } from "../charts/RiskReturnScatter";
import { Sparkline } from "../charts/Sparkline";
import { assetTypeColor, type ThemeName } from "../charts/palette";
import { TableView, type Column } from "../components/TableView";
import { Card, ErrorNotice, Loading, Reading, WindowPicker, METRIC_WINDOWS } from "../components/ui";
import { betaReading, riskReading } from "../readings";
import { PinButton } from "../components/PinButton";
import { usePins } from "../pins";
import { setUrlParams, useUrlNumber } from "../urlState";

export function RiskPage({ theme }: { theme: ThemeName }) {
  const [windowDays, setWindow] = useUrlNumber("window", METRIC_WINDOWS, 365, "replace");
  const pins = usePins();
  const risk = useQuery({
    queryKey: ["risk-return", windowDays],
    queryFn: () => api.riskReturn(windowDays),
  });
  // ~135 x 52 weekly closes, about 60 kB. One request for the whole column;
  // per-ticker fetching would be 135 round trips to draw one column.
  const shapes = useQuery({
    queryKey: ["sparklines", windowDays],
    queryFn: () => api.sparklines(windowDays),
  });
  // One fit per asset, in one request, for the same reason the sparklines are:
  // the table shows every asset at once.
  const fits = useQuery({
    queryKey: ["beta", windowDays],
    queryFn: () => api.beta(windowDays),
  });
  const closesFor = new Map((shapes.data ?? []).map((s) => [s.ticker, s.closes]));
  const fitFor = new Map((fits.data ?? []).map((f) => [f.ticker, f]));

  const columns: Column<RiskMetric>[] = [
    {
      // No header: a column of controls is not a measurement, and "Pin" above
      // 135 buttons labels the button, not the column.
      header: "",
      value: () => "",
      cell: (r) => <PinButton ticker={r.ticker} pins={pins} compact />,
    },
    {
      header: "Asset",
      value: (r) => r.ticker,
      align: "left",
      // The swatch is the chart's equity/crypto hue, and the ticker is a way
      // into that asset's own page - the table is where identity lives now
      // that the scatter only labels its extremes.
      cell: (r) => (
        <>
          <span className="swatch" style={{ background: assetTypeColor(r.asset_type, theme) }} />
          <button
            className="link"
            onClick={() => setUrlParams({ tab: "asset", ticker: r.ticker })}
          >
            {r.ticker}
          </button>
        </>
      ),
    },
    { header: "Name", value: (r) => r.name, align: "left" },
    {
      // The CSV gets the window's return, not the polyline: a shape is not a
      // value, and exporting 52 numbers into one cell helps nobody.
      header: "Shape",
      value: (r) => r.total_return,
      cell: (r) => <Sparkline closes={closesFor.get(r.ticker) ?? []} theme={theme} />,
    },
    { header: "Sector", value: (r) => r.sector, align: "left" },
    {
      header: "Return",
      value: (r) => r.annualized_return,
      cell: (r) => fmtPct(r.annualized_return),
      term: "annualised_return",
    },
    {
      header: "Volatility",
      value: (r) => r.annualized_volatility,
      cell: (r) => fmtPct(r.annualized_volatility),
      term: "volatility",
    },
    {
      header: "Return / risk",
      value: (r) => r.return_per_unit_risk,
      cell: (r) => r.return_per_unit_risk?.toFixed(2) ?? "\u2014",
      term: "return_per_unit_risk",
    },
    {
      header: "Max drawdown",
      value: (r) => r.max_drawdown,
      cell: (r) => fmtPct(r.max_drawdown),
      term: "max_drawdown",
    },
    {
      header: "Beta",
      value: (r) => fitFor.get(r.ticker)?.beta ?? null,
      cell: (r) => fitFor.get(r.ticker)?.beta?.toFixed(2) ?? "\u2014",
      term: "beta",
    },
    {
      // The column that says whether the beta beside it means anything. Kept
      // adjacent on purpose: read apart, a beta invites more confidence than
      // an R-squared of 0.02 can support.
      header: "Explained by market",
      value: (r) => fitFor.get(r.ticker)?.r_squared ?? null,
      cell: (r) => fmtPct(fitFor.get(r.ticker)?.r_squared, 0),
      term: "r_squared",
    },
    {
      header: "Market",
      value: (r) => fitFor.get(r.ticker)?.market ?? "",
      align: "left",
      term: "market_index",
    },
    {
      header: "Avg volume",
      value: (r) => r.avg_volume,
      cell: (r) => fmtCompact(r.avg_volume),
      term: "avg_volume",
    },
  ];

  return (
    <>
      <div className="controls">
        <WindowPicker value={windowDays} onChange={setWindow} />
      </div>

      <Card
        title="Risk versus return"
        subtitle="Every tracked asset on one plane, coloured by equity versus crypto only. A scatter puts arbitrary pairs side by side, which caps it at three distinguishable hues — nowhere near the 19 sectors, so sector lives in the tooltip and the table instead. Click a ticker for that asset on its own."
      >
        {risk.isPending ? <Loading height={340} /> : risk.error ? <ErrorNotice error={risk.error} /> : (
          <>
            <Reading text={riskReading(risk.data!)} />
            {fits.data && <Reading text={betaReading(fits.data)} />}
            <RiskReturnScatter data={risk.data!} theme={theme} />
            <TableView
              label="asset table"
              filename={`tickerql-risk-return-${windowDays}d`}
              columns={columns}
              data={risk.data ?? []}
            />
          </>
        )}
      </Card>
    </>
  );
}
