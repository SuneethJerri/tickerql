-- 001_schema.sql — base tables for the market data warehouse.
-- Idempotent: safe to re-run against an existing database.

CREATE SCHEMA IF NOT EXISTS market;

-- ---------------------------------------------------------------------------
-- assets: the tradeable universe. One row per instrument we track.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.assets (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticker        text        NOT NULL UNIQUE,
    name          text        NOT NULL,
    asset_type    text        NOT NULL CHECK (asset_type IN ('stock', 'crypto')),
    sector        text        NOT NULL,
    currency      text        NOT NULL DEFAULT 'USD',
    -- Symbol the OHLCV provider uses, when it differs from the display ticker
    -- (e.g. ticker 'BTC' -> yfinance symbol 'BTC-USD'). NULL means "same as ticker".
    source_symbol text,
    -- CoinGecko's own id (e.g. 'bitcoin'); NULL for equities.
    coingecko_id  text,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- Crypto rows must carry a CoinGecko id; equities must not.
    CONSTRAINT assets_coingecko_id_matches_type CHECK (
        (asset_type = 'crypto' AND coingecko_id IS NOT NULL) OR
        (asset_type = 'stock'  AND coingecko_id IS NULL)
    )
);

COMMENT ON TABLE  market.assets IS 'Tradeable universe: 4 equity sectors plus crypto.';
COMMENT ON COLUMN market.assets.sector IS 'Technology | Energy | Financials | Healthcare | Crypto.';

CREATE INDEX IF NOT EXISTS assets_sector_idx     ON market.assets (sector);
CREATE INDEX IF NOT EXISTS assets_asset_type_idx ON market.assets (asset_type);

-- ---------------------------------------------------------------------------
-- price_history: daily OHLCV bars. Grain = one row per (asset, calendar date).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.price_history (
    asset_id    integer     NOT NULL REFERENCES market.assets (id) ON DELETE CASCADE,
    date        date        NOT NULL,
    open        numeric(20, 8),
    high        numeric(20, 8),
    low         numeric(20, 8),
    close       numeric(20, 8) NOT NULL,
    -- Split/dividend-adjusted close. Returns are computed from this when
    -- present, so corporate actions don't show up as phantom price moves.
    adj_close   numeric(20, 8),
    volume      numeric(24, 4),
    source      text        NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, date),
    CONSTRAINT price_history_close_positive CHECK (close > 0),
    CONSTRAINT price_history_adj_close_positive CHECK (adj_close IS NULL OR adj_close > 0),
    CONSTRAINT price_history_volume_non_negative CHECK (volume IS NULL OR volume >= 0),
    -- Only enforced when the full bar is present; CoinGecko-sourced crypto rows
    -- may carry close/volume with NULL open/high/low.
    CONSTRAINT price_history_high_low_ordered CHECK (
        high IS NULL OR low IS NULL OR high >= low
    )
);

COMMENT ON TABLE  market.price_history IS 'Daily OHLCV bars, one row per asset per date.';
COMMENT ON COLUMN market.price_history.source IS 'Provider that produced the row: yfinance | coingecko | tiingo | alphavantage.';

-- Supports "latest N bars for this asset", the dominant access pattern.
CREATE INDEX IF NOT EXISTS price_history_asset_date_desc_idx
    ON market.price_history (asset_id, date DESC);
-- Supports cross-sectional "all assets on this date" scans.
CREATE INDEX IF NOT EXISTS price_history_date_idx
    ON market.price_history (date);

-- ---------------------------------------------------------------------------
-- ingest_runs: operational audit trail. Deliberately NOT readable by the
-- text-to-SQL agent role - it is infrastructure, not market data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market.ingest_runs (
    id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    command           text        NOT NULL,
    source            text        NOT NULL,
    started_at        timestamptz NOT NULL DEFAULT now(),
    finished_at       timestamptz,
    assets_attempted  integer     NOT NULL DEFAULT 0,
    assets_succeeded  integer     NOT NULL DEFAULT 0,
    rows_upserted     integer     NOT NULL DEFAULT 0,
    status            text        NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'ok', 'partial', 'failed')),
    detail            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    error             text
);

CREATE INDEX IF NOT EXISTS ingest_runs_started_at_idx ON market.ingest_runs (started_at DESC);
