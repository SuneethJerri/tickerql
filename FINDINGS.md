# Findings

Five things the data says, with the uncertainty attached to each.

**Data.** 135 assets across 19 sectors (11 GICS, 7 Indian NSE, plus crypto),
106,212 daily bars from 2023-08-22 to 2026-08-29. Crypto runs to 2026-08-29 and
equities to 2026-08-28, because crypto trades weekends and equities do not.
Returns come from split-adjusted closes. Volatility is annualised at 252 periods
per year for equities and 365 for crypto.

**Method.** Every correlation carries a 95% confidence interval from the Fisher
z-transform: `z = atanh(r)` is approximately normal with standard error
`1/sqrt(n-3)`, so the interval is `tanh(z ± 1.96/sqrt(n-3))`. It is asymmetric
around the estimate, which is correct, because there is more room below 0.9 than
above it. Read the intervals as a floor on the uncertainty, not a measurement of
it: Fisher assumes normal, independent returns and daily returns are neither.
Where an interval contains zero, the estimate is not distinguishable from no
relationship at all, and I say so rather than quoting the point estimate.

The queries behind every number are in [`db/queries/`](db/queries/); the exact
reproduction steps are at the bottom.

---

## 1. The sign of the risk-return relationship is decided by 12 of the 135 assets

Across all 135 assets over a trailing year, more volatile assets returned
**less**:

| Universe | r(volatility, return) | 95% interval | n |
|---|---|---|---|
| All assets | **-0.288** | [-0.436, -0.125] | 135 |
| Equities only | **+0.266** | [+0.093, +0.423] | 123 |

Both intervals exclude zero and they have opposite signs. The whole reversal
comes from 12 crypto assets, which over this window averaged 65.3% annualised
volatility and **-51.3%** annualised return. They sit alone in the
high-volatility, negative-return corner and drag the fitted relationship
through it.

The same measurement is also unstable across windows, on the full universe:

| Window | r(volatility, return) | 95% interval | |
|---|---|---|---|
| 30 days | +0.565 | [+0.438, +0.670] | |
| 90 days | -0.039 | [-0.207, +0.131] | contains zero |
| 365 days | -0.288 | [-0.436, -0.125] | |

Strongly positive at 30 days, unreadable at 90, clearly negative at 365, on the
same universe.

**What follows.** Any statement of the form "riskier assets earned more here" is
a statement about a window and a universe, not about the market. The dashboard's
risk-vs-return scatter separates equities from crypto by colour for exactly this
reason. If this were a report to a desk, the finding would be that crypto has to
be reported as its own book, because pooling it with equities inverts the
headline number while leaving the confidence interval looking respectable.

## 2. Most short-window correlations are not measurable at all

There are 9,045 asset pairs. Asking what fraction have a correlation
distinguishable from zero:

| Span | Median shared observations | Smallest readable \|r\| | Pairs distinguishable from zero |
|---|---|---|---|
| ~60 calendar days | 42 | 0.304 | **18.9%** (1,713) |
| 1 year | 250 | 0.124 | 37.2% (3,363) |
| Full span | 757 | 0.071 | **57.8%** (5,226) |

Mean |r| over the short window is 0.184, comfortably below the 0.304 needed to
read it. Four fifths of the correlations visible on a two-month view are noise.

Apple and Microsoft make it concrete. Over the full three years their
correlation is **+0.353** [+0.289, +0.414] on 757 shared trading days, clearly
positive. Over the most recent 60 shared trading days it is **+0.138**
[-0.120, +0.379], which cannot be told apart from zero. Nothing about the two
companies changed; the sample got smaller.

**What follows.** A correlation heatmap on a short window is mostly a picture of
its own sampling error. This is why the rolling-correlation chart in the app
draws the interval band behind the line, and why the default window is 60 days
rather than 30.

## 3. Whether crypto diversifies depends on whether you measure assets or books

The same data answers this question two ways, and they differ by nearly a factor
of five.

| Estimator | Trailing 365d | Full span |
|---|---|---|
| Mean of 1,116 pairwise crypto x US-equity correlations | +0.075 | +0.104 |
| Correlation of the two equal-weighted **index** series | **+0.356** | **+0.333** |
| Mean of 4,278 pairwise correlations *within* US equities, for scale | +0.100 | +0.186 |

Read pairwise, crypto looks like an excellent diversifier: at 0.075 a crypto
asset is *less* correlated to a US equity than two US equities are to each other
(0.100). That is the reading in the README's generated insights section, and it
is arithmetically correct.

Read as books, it is not. Aggregate the twelve crypto assets into one
equal-weighted series and the 123 US equities into another, and over the
trailing year the two move together at 0.356 [+0.243, +0.460] on 250 shared
trading days.

Both numbers are right. The gap is idiosyncratic risk: a single crypto against a
single stock is mostly two independent noise processes, and that noise dilutes
every pairwise estimate. Aggregating cancels it and leaves the common factor
standing, which is the only part that survives in a portfolio.

**What follows.** Diversification is a property of portfolios, so the index
estimate is the decision-relevant one, and the pairwise view understates the
correlation an allocator actually experiences by roughly five times. This is the
finding I would lead with in a review: not "the number is wrong" but "the number
answers a different question than the one being asked".

## 4. Measured as books, crypto's equity correlation is a regime, not a constant

Taking the index estimator from finding 3 and breaking it out by quarter, the
US-equity/crypto correlation ranges from **+0.055** [-0.196, +0.299] in Q4 2023
to **+0.561** [+0.366, +0.709] in Q3 2024. Three of the twelve full quarters
cannot be distinguished from zero (Q4 2023, Q2 2026 and Q3 2026); the other nine
can.

The full-span figure of 0.333 is an average over a quantity that spent the
period moving between "no measurable relationship" and "moves together about as
much as two equity sectors do".

Against the same index estimator, the Indian listings are the better
diversifier over the full span:

| Pair | r | 95% interval | n | Distinguishable from zero |
|---|---|---|---|---|
| US equities vs crypto | +0.333 | [+0.268, +0.395] | 757 | yes |
| India vs US equities | +0.121 | [+0.049, +0.193] | 722 | yes, barely |
| India vs crypto | **+0.043** | [-0.029, +0.114] | 748 | **no** |

**What follows.** A diversification assumption calibrated on any one quarter
here would have been wrong in several of the others, and the error is largest
exactly when it matters, because the high-correlation quarters are the ones
where diversification was supposed to help. The only pair in this universe whose
correlation cannot be told apart from zero is Indian equities against crypto.

## 5. Maximum drawdown is mostly, but not entirely, volatility in disguise

| Window | r(volatility, \|max drawdown\|) | 95% interval | Shared variance |
|---|---|---|---|
| 30 days | +0.538 | [+0.405, +0.648] | 29% |
| 90 days | +0.831 | [+0.770, +0.877] | 69% |
| 365 days | **+0.862** | [+0.811, +0.900] | **74%** |

Over a year, three quarters of the variation in drawdown is already in the
volatility figure. Over a month, under a third is, because a month is short
enough for the order of the moves to matter: an asset can be volatile without
ever stringing enough down-days together to make a deep peak-to-trough fall.

The residual quarter at 365 days is not noise, and it is what the README's
insight section is pointing at: volatility treats a 5% rise and a 5% fall as the
same event, so it prices the size of the moves and not their order. Drawdown is
the order.

**What follows.** As a *ranking* device over a long window, drawdown adds little
to volatility and reporting both invites double-counting. As a *description* of
what an investor sat through, it is not substitutable at any window, and it is
the only one of the two that answers "how bad did it get". Keep both, but stop
treating them as independent evidence in a long-horizon screen.

---

## Limits

These bound every claim above and are not a disclaimer.

**Survivorship.** The 135 assets were selected in August 2026 and backfilled.
Anything delisted, acquired, or collapsed inside the window is absent. This
biases returns upward and understates tail risk, and it affects finding 1 most,
since a survivor-only universe cannot contain the worst high-volatility
outcomes.

**One period.** Everything here is conditional on 2023-08 to 2026-08. Findings
3 and 4 are statements about this window, not about crypto.

**Interval assumptions.** Fisher z assumes bivariate normal, independent
observations. Daily returns are fat-tailed and volatility-clustered, so the true
intervals are wider than the ones quoted. Where I say "not distinguishable from
zero" that conclusion is safe, because a wider interval only reinforces it.
Where I say "distinguishable", treat a marginal case such as India vs US
equities (lower bound +0.049) as weaker than its interval suggests.

**Short windows move.** The 30-day figures in findings 1 and 5 shifted
materially when this analysis was re-run one trading day later: the risk-return
correlation moved from +0.541 to +0.565 and the drawdown-volatility correlation
from +0.457 to +0.538. A single new observation is a thirtieth of that window.
Treat every 30-day number here as an illustration of instability rather than as
a measurement worth carrying forward.

**Overlapping windows.** Consecutive points in a rolling series share all but
one observation, so the series is heavily autocorrelated. A band drawn on it
describes the uncertainty of each window on its own; it does not license
treating consecutive points as independent evidence.

**Currency.** Indian returns are local-currency (INR). The India/US correlation
in finding 4 therefore excludes the exchange-rate effect that an unhedged
dollar investor would actually experience, and is a floor on the correlation
they would see.

**No risk-free rate.** `return_per_unit_risk` divides return by volatility with
the risk-free rate taken as zero, so it is not a Sharpe ratio and is not
comparable to published Sharpe figures.

## Reproducing

```bash
docker compose up -d db
.venv/bin/python -m ingest migrate
.venv/bin/python -m ingest backfill --years 3
.venv/bin/python -m ingest refresh-views
.venv/bin/python -m pytest          # 291 tests, including the interval maths
```

Findings 1, 2 and 5 come from `market.asset_metrics` and the correlation
queries in [`db/queries/`](db/queries/). Findings 3 and 4 build equal-weighted
index returns per group and correlate those series, so that `n` is the number of
trading days.

Three estimator notes, all of which changed an answer here:

- Pooling every (crypto, equity) pair into a single `corr()` treats 91,908
  pair-days as independent observations and returns an interval about ten times
  too narrow. That was the first version of finding 4 and it was wrong.
- Averaging pairwise correlations and correlating aggregated indices are
  different estimators that answer different questions. Finding 3 is entirely
  about the gap between them.
- "The last 60 trading days" for a pair of equities means the last 60 days
  *both* traded, not the last 60 rows of a calendar that also contains crypto
  weekends. Taking the latter silently computes a 42-observation window and
  labels it 60.

The interval maths is in
[`db/queries/rolling_correlation.sql`](db/queries/rolling_correlation.sql) and
is checked against an independent Python implementation in
[`api/tests/test_queries.py`](api/tests/test_queries.py).
