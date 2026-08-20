-- price_history.sql — raw OHLCV for one asset, for the price-trend chart.
-- Params: ticker, start (nullable date), end (nullable date)
SELECT
    p.date,
    p.open,
    p.high,
    p.low,
    p.close,
    p.adj_close,
    p.volume
FROM market.price_history p
JOIN market.assets a ON a.id = p.asset_id
WHERE a.ticker = %(ticker)s
  AND (%(start)s::date IS NULL OR p.date >= %(start)s::date)
  AND (%(end)s::date   IS NULL OR p.date <= %(end)s::date)
ORDER BY p.date;
