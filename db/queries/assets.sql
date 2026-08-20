-- assets.sql — the tracked universe with coverage stats.
-- Params: none
SELECT
    a.ticker,
    a.name,
    a.asset_type,
    a.sector,
    a.currency,
    count(p.date)                    AS bar_count,
    min(p.date)                      AS first_date,
    max(p.date)                      AS last_date
FROM market.assets a
LEFT JOIN market.price_history p ON p.asset_id = a.id
WHERE a.is_active
GROUP BY a.ticker, a.name, a.asset_type, a.sector, a.currency
ORDER BY a.sector, a.ticker;
