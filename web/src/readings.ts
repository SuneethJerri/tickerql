/** What each view actually shows, in a sentence, computed from the data the
 *  chart already has.
 *
 * A chart hands the reader a shape and asks them to find the story in it. That
 * works if they already know what volatility is and roughly what value is
 * normal. A reading states the finding, so the view is legible to someone who
 * knows none of that.
 *
 * Two rules, both of which decide whether a reading is worth rendering:
 *
 * 1. Say something a glance does not already give. "Energy is the tallest bar"
 *    is the chart read aloud. That the ranking changes when you divide by
 *    volatility is not visible anywhere on the page.
 * 2. Return null rather than pad. Partial data, one row, no spread worth
 *    naming: no sentence. A reading that appears on every view regardless of
 *    whether it has anything to say becomes furniture, and furniture is not
 *    read.
 *
 * Every function here is pure and takes exactly what its chart takes, so a
 * reading cannot disagree with the chart above it, and none of them costs a
 * request or a model call.
 */
import type {
  Beta, RiskMetric, SectorCorrelationCell, SectorPerformance, TailRisk,
} from "./api";

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const signedPct = (v: number, digits = 1) =>
  `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

/** Pearson correlation, for the cross-sectional relationships a reading claims.
 *  Returns null on fewer than three usable pairs or on a constant column, where
 *  the coefficient is undefined rather than zero. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** Sector performance: how many finished up, the spread, and whether ranking by
 *  return and by return-per-risk disagree. */
export function sectorReading(rows: SectorPerformance[]): string | null {
  const usable = rows.filter((r) => r.total_return != null);
  if (usable.length < 3) return null;

  const byReturn = [...usable].sort((a, b) => b.total_return! - a.total_return!);
  const best = byReturn[0]!;
  const worst = byReturn[byReturn.length - 1]!;
  const up = usable.filter((r) => r.total_return! > 0).length;

  const parts = [
    `${up} of ${usable.length} sectors finished the window up.`,
    `${best.sector} returned the most at ${signedPct(best.total_return!)}, ${worst.sector} the least at ${signedPct(worst.total_return!)}.`,
  ];

  // The part a bar chart cannot show: the best return and the best return per
  // unit of risk are usually different sectors, which is the whole reason the
  // second column exists.
  const ranked = usable.filter((r) => r.return_per_unit_risk != null && r.annualized_volatility != null);
  const byRatio = [...ranked].sort((a, b) => b.return_per_unit_risk! - a.return_per_unit_risk!);
  const leader = byRatio[0];
  if (leader && leader.sector !== best.sector && best.annualized_volatility != null) {
    parts.push(
      `Ranked by return per unit of risk the leader is ${leader.sector} instead, which returned less than ${best.sector} but at ${pct(leader.annualized_volatility!, 0)} volatility against ${pct(best.annualized_volatility, 0)}.`,
    );
  }
  return parts.join(" ");
}

/** Risk versus return: the cross-sectional relationship, and whether it is the
 *  same relationship once crypto is out of it. */
export function riskReading(rows: RiskMetric[]): string | null {
  const usable = rows.filter(
    (r) => r.annualized_volatility != null && r.annualized_return != null,
  );
  if (usable.length < 10) return null;

  const all = pearson(
    usable.map((r) => r.annualized_volatility!),
    usable.map((r) => r.annualized_return!),
  );
  if (all == null) return null;

  const direction = all > 0.1 ? "more" : all < -0.1 ? "less" : "no more";
  const parts = [
    `Across these ${usable.length} assets, more volatile ones earned ${direction} on average: the correlation between volatility and return is ${all.toFixed(2)}.`,
  ];

  const equities = usable.filter((r) => r.asset_type === "stock");
  const equityOnly =
    equities.length >= 10
      ? pearson(
          equities.map((r) => r.annualized_volatility!),
          equities.map((r) => r.annualized_return!),
        )
      : null;

  // A sign flip between the two universes is the finding. Anything less is
  // not worth a second sentence.
  if (equityOnly != null && Math.sign(equityOnly) !== Math.sign(all)) {
    parts.push(
      `Among the ${equities.length} equities alone it is ${equityOnly.toFixed(2)}, so the sign comes from the ${usable.length - equities.length} crypto assets rather than from the market.`,
    );
  }
  return parts.join(" ");
}

/** Sector correlation: the typical pair, the extremes, and a reference for
 *  what the numbers mean, since a reader new to correlation has no sense of
 *  the scale.
 *
 * Deliberately NOT the Fisher significance threshold, though that was the
 * first version. Each cell is the MEAN of many pairwise correlations, and the
 * threshold for a single pair does not transfer to an average of twelve: the
 * mean is steadier than any of its members, so quoting the single-pair bound
 * beside it overstates the noise. The bound belongs on the rolling chart,
 * where each point really is one pair. Here the useful thing is a yardstick. */
export function correlationReading(
  cells: SectorCorrelationCell[],
): string | null {
  const cross = cells.filter((c) => c.sector_a !== c.sector_b && c.correlation != null);
  if (cross.length < 3) return null;

  const values = cross.map((c) => c.correlation!);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...cross].sort((a, b) => b.correlation! - a.correlation!);
  const top = sorted[0]!;
  const bottom = sorted[sorted.length - 1]!;

  const parts = [
    `The average pair of different sectors moves together at ${mean.toFixed(2)}.`,
    `${top.sector_a} and ${top.sector_b} are the most related at ${top.correlation!.toFixed(2)}; ${bottom.sector_a} and ${bottom.sector_b} the least at ${bottom.correlation!.toFixed(2)}.`,
  ];

  // A yardstick, because 0.4 means nothing to a reader who has never seen a
  // correlation. Two assets inside one narrow sector reach about 0.7, which
  // puts the whole grid in the mild half of the scale.
  parts.push(
    top.correlation! < 0.6
      ? `For scale, two assets inside a single narrow sector typically reach about 0.7, so even the strongest pair here is a mild relationship, and most of the grid sits close to no relationship at all.`
      : `For scale, 0 is no relationship and 1 is lockstep; two assets inside a single narrow sector typically reach about 0.7.`,
  );
  return parts.join(" ");
}

/** One asset: what it did, and where that puts it among the rest. */
export function assetReading(
  metric: RiskMetric | undefined,
  universe: number,
  peerRank?: { rank: number; total: number; sector: string } | null,
): string | null {
  if (!metric || metric.annualized_return == null || metric.annualized_volatility == null) {
    return null;
  }

  const parts = [
    `${metric.ticker} returned ${signedPct(metric.total_return ?? metric.annualized_return)} over the window at ${pct(metric.annualized_volatility, 0)} annualised volatility, the ${ordinal(metric.volatility_rank)} most volatile of ${universe} assets.`,
  ];

  if (metric.max_drawdown != null) {
    parts.push(
      `Its worst peak-to-trough fall inside the window was ${pct(Math.abs(metric.max_drawdown))}.`,
    );
  }
  if (peerRank && peerRank.total > 2) {
    parts.push(
      `Against the ${peerRank.total} assets in ${peerRank.sector} it ranks ${ordinal(peerRank.rank)} on return per unit of risk.`,
    );
  }
  return parts.join(" ");
}

/** The assets inside one sector: the spread within it, which is the thing a
 *  sector-level average hides. */
export function sectorDetailReading(
  rows: RiskMetric[],
  sector: string,
): string | null {
  const usable = rows.filter((r) => r.sector === sector && r.total_return != null);
  if (usable.length < 3) return null;

  const sorted = [...usable].sort((a, b) => b.total_return! - a.total_return!);
  const best = sorted[0]!;
  const worst = sorted[sorted.length - 1]!;
  const up = usable.filter((r) => r.total_return! > 0).length;

  const parts = [
    `${up} of the ${usable.length} assets in ${sector} finished the window up.`,
    `${best.ticker} led at ${signedPct(best.total_return!)} and ${worst.ticker} trailed at ${signedPct(worst.total_return!)}.`,
  ];

  // A sector average is only a useful summary when its members agree.
  const spread = best.total_return! - worst.total_return!;
  if (spread > 0.5) {
    parts.push(
      `That is a ${pct(spread, 0)} spread inside one sector, so the sector figure is an average over assets that did quite different things.`,
    );
  }
  return parts.join(" ");
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Return distribution: the tails, priced two ways.
 *
 * Kurtosis is the statistician's version of this sentence and is unreadable
 * without the vocabulary, so the reading leads with the count - "3 days moved
 * more than 3 standard deviations; a normal curve predicts 0.7" - and follows
 * with the concentration figure, which is the same fact stated in money. */
export function distributionReading(
  tail: TailRisk,
  ticker: string,
): string | null {
  if (tail.observations < 30 || tail.daily_volatility == null) return null;

  const parts: string[] = [];
  const ratio = tail.beyond_3sd / Math.max(tail.expected_beyond_3sd, 1e-9);
  if (tail.beyond_3sd > 0 && ratio >= 1.5) {
    parts.push(
      `${ticker} moved more than three standard deviations on ${tail.beyond_3sd} of ${tail.observations} days. A normal distribution of the same width predicts ${tail.expected_beyond_3sd.toFixed(1)}, so its extremes arrive about ${Math.round(ratio)} times more often than the volatility figure alone implies.`,
    );
  } else if (tail.excess_kurtosis != null) {
    parts.push(
      `${ticker} saw ${tail.beyond_3sd} days beyond three standard deviations against ${tail.expected_beyond_3sd.toFixed(1)} predicted, so its tails are close to what a normal distribution would give.`,
    );
  }

  // The same statement without any statistics in it. This is usually the
  // sentence a reader repeats back.
  if (
    tail.total_return != null &&
    tail.total_return_without_best_5 != null &&
    tail.observations >= 60
  ) {
    parts.push(
      `Take away its five best days and the window's ${signedPct(tail.total_return)} becomes ${signedPct(tail.total_return_without_best_5)}.`,
    );
  }

  if (tail.skewness != null && Math.abs(tail.skewness) > 0.4) {
    parts.push(
      tail.skewness < 0
        ? `Its large moves lean downward: the biggest single day was a fall.`
        : `Its large moves lean upward: the biggest single day was a rise.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

/** One asset's market fit, stated as the two things a beta cannot say alone. */
export function assetBetaReading(fit: Beta): string | null {
  if (fit.beta == null || fit.r_squared == null) return null;

  const parts = [
    `A 1% day for ${fit.market} moves ${fit.ticker} ${fit.beta.toFixed(2)}% on average${
      fit.beta_low != null && fit.beta_high != null
        ? ` (between ${fit.beta_low.toFixed(2)} and ${fit.beta_high.toFixed(2)} once the uncertainty in the fit is allowed for)`
        : ""
    }.`,
  ];

  // The figure that decides whether the beta is worth anything. A slope fitted
  // through a shapeless cloud is still a slope.
  const share = Math.round(fit.r_squared * 100);
  parts.push(
    share < 25
      ? `But that market explains only ${share}% of its day-to-day movement, so most of what ${fit.ticker} does is its own, and the beta is a weak summary of it.`
      : `That market explains ${share}% of its day-to-day movement, so the beta is a reasonable summary of how it behaves.`,
  );

  if (fit.beta_low != null && fit.beta_high != null && (fit.beta_low > 1 || fit.beta_high < 1)) {
    parts.push(
      fit.beta_low > 1
        ? `It reliably amplifies its market rather than tracking it.`
        : `It reliably damps its market rather than tracking it.`,
    );
  }
  return parts.join(" ");
}

/** Market sensitivity across the universe: which markets move as one thing.
 *
 * The comparison between markets is the finding. Any single beta is a fact
 * about one asset; that the typical crypto asset's market explains three
 * quarters of its movement while the typical US equity's explains under a
 * tenth is a fact about how differently the two behave. */
export function betaReading(rows: Beta[]): string | null {
  const usable = rows.filter((r) => r.beta != null && r.r_squared != null);
  if (usable.length < 10) return null;

  const byMarket = new Map<string, Beta[]>();
  for (const r of usable) {
    const list = byMarket.get(r.market) ?? [];
    list.push(r);
    byMarket.set(r.market, list);
  }

  const ranked = [...byMarket.entries()]
    .filter(([, list]) => list.length >= 5)
    .map(([market, list]) => ({ market, list, share: median(list.map((r) => r.r_squared!)) }))
    .sort((a, b) => b.share - a.share);
  if (ranked.length < 2) return null;

  const most = ranked[0]!;
  const least = ranked[ranked.length - 1]!;
  // Market names are used verbatim. Lowercasing them turned "US equities"
  // into "us equities", and singularising turned "Crypto" into a possessive
  // that read as a typo.
  const parts = [
    `The typical ${most.market} asset has ${pct(most.share, 0)} of its daily movement explained by its own market; for ${least.market} it is ${pct(least.share, 0)}.`,
  ];
  // Only worth a sentence when the gap is large enough to be a difference in
  // kind rather than in degree.
  if (most.share > least.share * 2) {
    // Neither market name is the subject of this sentence, because the three
    // of them are not all plural: "Crypto moves" and "US equities move" cannot
    // share a verb, and "US equities mostly does not" is what came out when
    // they tried.
    parts.push(
      `That is the difference between a market that moves as one thing and one that mostly does not, so a market-wide explanation carries much further in ${most.market} than in ${least.market}.`,
    );
  }

  // Assets whose interval clears 1 in one direction or the other: the ones
  // where "amplifies" or "damps" is a claim the data supports rather than a
  // reading of a point estimate.
  const decided = usable.filter(
    (r) => r.beta_low != null && r.beta_high != null && (r.beta_low > 1 || r.beta_high < 1),
  );
  if (decided.length > 0) {
    const amplify = decided.filter((r) => r.beta_low! > 1).length;
    parts.push(
      `Of ${usable.length} assets, ${amplify} move more than their market and ${decided.length - amplify} move less by a margin the data can actually separate from 1; the remaining ${usable.length - decided.length} cannot be told apart from simply tracking it.`,
    );
  }
  return parts.join(" ");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
