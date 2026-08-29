/** What every number on this dashboard means, in plain language.
 *
 * The app assumes a vocabulary that most visitors do not have. "Return per unit
 * of risk: 2.19" is unreadable without a definition, and the obvious guess is
 * wrong, because it is not a Sharpe ratio.
 *
 * These are static on purpose. "What is volatility" has one answer and does not
 * need a model call; the agent is for "why is THIS number what it is", which is
 * the question a fixed definition cannot answer. `Term` offers both.
 */

export interface Definition {
  /** Display name, which need not match the column header it sits on. */
  term: string;
  /** One sentence, no jargon, no formula. */
  short: string;
  /** How this app computes it. Precise, because the reader may be checking. */
  computed: string;
  /** The misreading this term invites. Omitted where there isn't one. */
  caution?: string;
  /** What a number of this kind looks like, for terms whose scale is not
   *  obvious. A reader who has never seen a correlation cannot tell whether
   *  0.3 is a lot. */
  scale?: string;
}

export const GLOSSARY: Record<string, Definition> = {
  volatility: {
    term: "Annualised volatility",
    short:
      "How much the price moves around, up or down, scaled to a yearly figure. Higher means a bumpier ride.",
    computed:
      "Standard deviation of daily log returns over the window, multiplied by the square root of 252 for equities or 365 for crypto, because crypto trades every day and equities do not.",
    caution:
      "It treats a 5% rise and a 5% fall as the same event, so it measures the size of the moves and not their direction.",
    scale:
      "A large stable company runs near 20%. 40% is a volatile stock. Most crypto in this universe sits between 60% and 85%.",
  },
  annualised_return: {
    term: "Annualised return",
    short:
      "What the asset earned over the window, restated as a yearly rate so windows of different lengths can be compared.",
    computed:
      "Taken from the mean daily log return: exp(mean × periods per year) − 1, using the same 252 or 365 periods as volatility.",
    caution:
      "On a window shorter than a year this extrapolates. A 30-day window annualised to +180% does not mean the asset will return 180%.",
  },
  total_return: {
    term: "Total return",
    short: "What the asset actually did over this window, start to finish.",
    computed:
      "Last adjusted close divided by the first adjusted close in the window, minus one. No annualisation.",
  },
  return_per_unit_risk: {
    term: "Return per unit of risk",
    short:
      "How much return the asset produced for each unit of bumpiness it put you through. Higher is better; two assets with the same return are not the same investment if one got there far more erratically.",
    computed: "Annualised return divided by annualised volatility.",
    caution:
      "This is NOT a Sharpe ratio. A Sharpe ratio subtracts the risk-free rate first; this takes it as zero, so these figures are not comparable with published Sharpe numbers.",
    scale: "Above 1.0 is good over this window. Negative means the asset lost money.",
  },
  max_drawdown: {
    term: "Maximum drawdown",
    short:
      "The worst peak-to-trough fall inside the window: how far down it went from its own high before recovering, and the loss someone holding it had to sit through.",
    computed:
      "The largest fall from a running peak of the adjusted close to any later low within the window.",
    caution:
      "Volatility prices the size of the moves; drawdown prices the order they arrived in. Over a year the two are about 86% correlated, so on a long window they carry much the same information.",
  },
  correlation: {
    term: "Correlation",
    short:
      "Whether two things tend to move on the same days. +1 is lockstep, 0 is unrelated, −1 is exact opposites.",
    computed:
      "Pearson correlation of daily returns over the days both assets actually traded. Crypto trades weekends and equities do not, so a mixed pair is computed on the overlap.",
    caution:
      "A short window cannot measure a small correlation. Over 60 days, anything under about 0.25 cannot be told apart from zero.",
    scale:
      "Two large US equities typically run 0.3 to 0.5. Two assets in the same narrow sector reach 0.7. Above 0.85 is near-lockstep, which in this universe is mostly crypto against crypto.",
  },
  rolling_correlation: {
    term: "Rolling correlation",
    short:
      "The same correlation, recomputed on every date from the most recent N trading days, so you can see it change instead of getting one average.",
    computed:
      "A trailing window over shared trading days. Windows that are not yet full are dropped rather than drawn from partial data.",
    caution:
      "Consecutive points share all but one observation, so the line is much smoother than independent measurements would be. Do not read a slow drift as a series of separate findings.",
  },
  confidence_interval: {
    term: "Confidence interval",
    short:
      "The range the true value plausibly sits in, given how much data went into the estimate. A wide band means the number is not pinned down.",
    computed:
      "95% interval from the Fisher z-transform: tanh(atanh(r) ± 1.96/√(n−3)), where n is the number of shared observations.",
    caution:
      "A floor on the uncertainty, not a measurement of it. It assumes normal, independent returns and daily returns are neither, so the real range is wider. Where the band crosses zero, the correlation cannot be distinguished from no relationship at all.",
  },
  indexed_value: {
    term: "Indexed value",
    short:
      "Every series restarted at 100 on the first day of the window, so things at wildly different prices can be compared on one chart.",
    computed:
      "Equal-weighted daily sector returns compounded forward from a base of 100 at the start of the window.",
    caution:
      "Indian sectors are priced in INR, so their panels are local-currency returns and are not directly comparable with the USD ones.",
  },
  equal_weighted: {
    term: "Equal-weighted",
    short:
      "Every asset in the group counts the same, regardless of how large the company is.",
    computed:
      "The sector's daily return is the plain average of its members' daily returns.",
    caution:
      "A real index is usually weighted by company size, so these figures will not match a published sector index.",
  },
  moving_average: {
    term: "Moving average",
    short:
      "The average close over the last N days, redrawn each day. It smooths out daily noise to show the underlying direction.",
    computed:
      "Mean of the trailing N closes, computed over full history so the left edge of the window is not a partial average.",
  },
  adjusted_close: {
    term: "Adjusted close",
    short:
      "The closing price restated so that splits and dividends do not look like price moves.",
    computed:
      "Every return in this app comes from the adjusted close, falling back to the raw close only when no adjusted figure exists.",
    caution:
      "Raw closes make a stock split look like a crash. Both NVDA and AAPL split inside this window.",
  },
  beta: {
    term: "Beta",
    short:
      "How far an asset tends to move when its market moves. A beta of 1.3 means it typically moves 1.3% on a day its market moves 1%.",
    computed:
      "The slope of a regression of the asset's daily returns on the equal-weighted index of its own market. The asset is left out of that index, so nothing is measured against itself.",
    caution:
      "A beta is only as meaningful as the fit behind it. Check R-squared: the same slope through a tight band and a shapeless cloud are very different claims, and the second one is close to meaningless.",
    scale:
      "Around 1 means it moves with its market. Above 1 amplifies it, below 1 damps it, and below 0 means it tends to move the other way.",
  },
  market_index: {
    term: "Market",
    short:
      "The group of assets a beta is measured against. This app uses three: US equities, Indian equities, and crypto.",
    computed:
      "The equal-weighted average daily return of every other asset in the same group, recomputed for each asset so none is part of its own benchmark.",
    caution:
      "Three markets rather than one because this universe holds two currencies and an asset class that trades weekends. Regressing an Indian stock on a dollar index would measure the exchange rate as much as the company.",
  },
  r_squared: {
    term: "R-squared",
    short:
      "The share of an asset's day-to-day movement that its market accounts for. The rest is the asset doing its own thing.",
    computed: "The square of the correlation between the asset's daily returns and its market's.",
    caution:
      "It says nothing about whether the asset made money. An asset can have a high R-squared and be falling, if its market is falling too.",
    scale:
      "In this data a typical US equity sits near 0.09 and a typical crypto asset near 0.77. Crypto moves as one thing; these equities largely do not.",
  },
  alpha: {
    term: "Alpha",
    short:
      "What was left over after the market was accounted for: the return the asset produced that its market does not explain.",
    computed:
      "The intercept of the same regression that produces beta, scaled to a yearly figure at 252 trading days for equities or 365 for crypto.",
    caution:
      "Not a skill measurement. Over one window it is mostly noise, and it is measured against an equal-weighted index of this universe rather than a real benchmark.",
  },
  excess_kurtosis: {
    term: "Excess kurtosis",
    short:
      "How much more often extreme days happen than they would if the returns followed a normal bell curve. Zero means exactly as often; higher means fatter tails.",
    computed:
      "The fourth standardised moment of daily returns, Fisher-Pearson adjusted, minus 3 so that a normal distribution scores 0.",
    caution:
      "It is driven almost entirely by the few largest days, so a single crash can move it a long way. The count of days beyond three standard deviations says the same thing more robustly.",
    scale:
      "Daily returns here run from about 0.5 to 15. Anything above 1 means the volatility figure is understating how often big days arrive.",
  },
  skewness: {
    term: "Skewness",
    short:
      "Whether the big moves lean up or down. Negative means the large days are mostly falls, positive means they are mostly rises.",
    computed: "The third standardised moment of daily returns, Fisher-Pearson adjusted.",
    caution:
      "It says nothing about which direction the asset went overall. A rising asset can be negatively skewed, and usually is.",
    scale: "Most assets here sit between -1 and +1. Beyond that, one or two days are doing the work.",
  },
  normal_reference: {
    term: "The normal curve",
    short:
      "The bell-shaped distribution most statistics assume. It is drawn here as a reference, not as a claim: daily returns do not follow it.",
    computed:
      "A normal distribution with the same mean and standard deviation as the asset's daily returns, scaled to the same number of days so it can be read against the bars.",
    caution:
      "The gap between the bars and the curve is the point of the chart. Real returns are taller in the middle and fatter at the edges, which means calm days and violent days are both more common than the curve predicts.",
  },
  observations: {
    term: "Trading days",
    short: "How many daily bars went into the figure beside it.",
    computed:
      "Days on which the asset actually traded. Fewer days means a less certain number, which is why this column is shown rather than assumed.",
  },
  avg_volume: {
    term: "Average volume",
    short:
      "Typical daily trading activity: how many shares or units changed hands on an average day in the window.",
    computed: "Mean daily volume over the window.",
    caution:
      "Useful as a liquidity signal, not as a performance one. High volume says an asset is easy to trade, not that it is doing well.",
  },
};

export function define(name: string): Definition | null {
  return GLOSSARY[name] ?? null;
}
