import { useQuery } from "@tanstack/react-query";
import { api, fmtPct, type SectorPerformance } from "../api";
import { SectorIndexChart } from "../charts/SectorIndexChart";
import { PriceMaChart } from "../charts/PriceMaChart";
import type { ThemeName } from "../charts/palette";
import { StatTile } from "../components/StatTile";
import { TableView, type Column } from "../components/TableView";
import { Card, ErrorNotice, Loading, WindowPicker, METRIC_WINDOWS } from "../components/ui";
import { setUrlParams, useUrlNumber, useUrlString } from "../urlState";
import { usePins } from "../pins";
import { PinnedStrip } from "../components/PinnedStrip";
import { AskAbout } from "../components/AskAbout";

export function Dashboard({ theme }: { theme: ThemeName }) {
  // "replace", not "push": these refine the current view, and flicking through
  // 30d/90d/365d should not bury the previous tab under three history entries.
  const [windowDays, setWindow] = useUrlNumber("window", METRIC_WINDOWS, 365, "replace");
  const [ticker, setTicker] = useUrlString("ticker", "AAPL", "replace");
  const pins = usePins();

  const assets = useQuery({ queryKey: ["assets"], queryFn: api.assets });
  // Same query key the topbar uses, so react-query serves this from cache
  // rather than making a second request for the same numbers.
  const health = useQuery({ queryKey: ["health"], queryFn: api.health });
  const perf = useQuery({
    queryKey: ["sector-performance", windowDays],
    queryFn: () => api.sectorPerformance(windowDays),
  });
  const index = useQuery({
    queryKey: ["sector-index", windowDays],
    queryFn: () => api.sectorIndex(windowDays),
  });
  const ma = useQuery({
    queryKey: ["ma", ticker, windowDays],
    queryFn: () => api.movingAverages(ticker, [20, 50, 200], windowDays),
  });

  const ranked = [...(perf.data ?? [])].sort(
    (a, b) => (b.return_per_unit_risk ?? -99) - (a.return_per_unit_risk ?? -99),
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const widest = [...(perf.data ?? [])].sort(
    (a, b) => (b.annualized_volatility ?? 0) - (a.annualized_volatility ?? 0),
  )[0];

  const sectorCount = new Set((perf.data ?? []).map((r) => r.sector)).size;

  return (
    <>
      {/* The one hero moment. Everything else on the page is quiet, which is
          what lets this be loud without the page shouting throughout. */}
      <header className="masthead">
        <h1>tickerql</h1>
        {/* Each fact is its own non-breaking span, separator included, so a
            narrow screen wraps BETWEEN facts rather than orphaning a "·" at
            the start of a line or splitting "105,930 bars" across two. */}
        <div className="meta">
          <span>{assets.data ? `${assets.data.length} assets` : "— assets"}</span>
          {sectorCount ? <span>{`${sectorCount} sectors`}</span> : null}
          {health.data?.price_rows
            ? <span>{`${health.data.price_rows.toLocaleString("en")} bars`}</span>
            : null}
          {health.data?.latest_bar ? <span>{`to ${health.data.latest_bar}`}</span> : null}
        </div>
      </header>

      <PinnedStrip pins={pins} windowDays={windowDays} theme={theme} />

      <div className="controls">
        <WindowPicker value={windowDays} onChange={setWindow} />
        <span className="control">
          Asset
          <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
            {(assets.data ?? []).map((a) => (
              <option key={a.ticker} value={a.ticker}>
                {a.ticker} — {a.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* Four figures with no boxes around them. Boxes-around-numbers is what
          every dashboard template does; a readout is what an instrument does,
          and the rules between the columns already separate them. */}
      <div className="readout">
        <StatTile label="Assets tracked" value={String(assets.data?.length ?? "—")} />
        <StatTile
          label="Best risk-adjusted"
          value={best?.sector ?? "—"}
          delta={best ? `${best.return_per_unit_risk?.toFixed(2)} return per unit risk` : undefined}
          deltaDirection="up"
        />
        <StatTile
          label="Weakest"
          value={worst?.sector ?? "—"}
          delta={worst ? `${worst.return_per_unit_risk?.toFixed(2)} return per unit risk` : undefined}
          deltaDirection="down"
        />
        <StatTile
          label="Most volatile"
          value={widest?.sector ?? "—"}
          delta={widest ? `${fmtPct(widest.annualized_volatility)} annualised` : undefined}
        />
      </div>

      <div className="grid">
        <Card
          title="Sector performance"
          subtitle="Equal-weighted and indexed to 100 at the start of the window, one panel per sector on a shared scale. Click a sector to see the assets behind it. Indian sectors are priced in INR, so their panels are local-currency returns and are not directly comparable with the USD ones."
          action={
            <AskAbout
              question={`Which sector had the best return per unit of risk over the last ${windowDays} days, and which assets drove it?`}
            />
          }
        >
          {index.isPending ? <Loading /> : index.error ? <ErrorNotice error={index.error} /> : (
            <>
              <SectorIndexChart
                data={index.data!}
                theme={theme}
                onSelect={(s) => setUrlParams({ tab: "sector", sector: s }, "push")}
              />
              <SectorTable rows={perf.data ?? []} windowDays={windowDays} />
            </>
          )}
        </Card>

        <Card
          title={`${ticker} price and moving averages`}
          subtitle="Close price with 20, 50 and 200-day averages. Averages are computed over full history, so the left edge is not a truncated series."
        >
          {ma.isPending ? <Loading /> : ma.error ? <ErrorNotice error={ma.error} /> : (
            <PriceMaChart series={ma.data!} theme={theme} />
          )}
        </Card>
      </div>
    </>
  );
}

const SECTOR_COLUMNS: Column<SectorPerformance>[] = [
  { header: "Sector", value: (r) => r.sector, align: "left" },
  { header: "Assets", value: (r) => r.asset_count },
  // The CSV carries the raw fraction; the table carries the formatted percent.
  // Exporting "57.7%" would force whoever opens it to strip the sign before
  // they could do arithmetic with it.
  { header: "Return", value: (r) => r.total_return, cell: (r) => fmtPct(r.total_return) },
  {
    header: "Volatility",
    value: (r) => r.annualized_volatility,
    cell: (r) => fmtPct(r.annualized_volatility),
  },
  {
    header: "Return / risk",
    value: (r) => r.return_per_unit_risk,
    cell: (r) => r.return_per_unit_risk?.toFixed(2) ?? "—",
  },
  { header: "Days", value: (r) => r.observations },
];

function SectorTable({
  rows, windowDays,
}: {
  rows: SectorPerformance[];
  windowDays: number;
}) {
  // Ranked by return rather than by a fixed sector order. The swatch is gone
  // with it: the panels above all wear one hue, so a coloured dot here would
  // claim a sector-to-colour mapping that no longer exists.
  const ordered = [...rows].sort(
    (a, b) => (b.total_return ?? -Infinity) - (a.total_return ?? -Infinity),
  );
  return (
    <TableView
      label="sector table"
      filename={`tickerql-sectors-${windowDays}d`}
      columns={SECTOR_COLUMNS}
      data={ordered}
    />
  );
}
