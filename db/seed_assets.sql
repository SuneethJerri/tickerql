-- seed_assets.sql — the tracked universe.
--
-- 16 assets: 13 equities across 4 sectors, plus 3 crypto. Chosen for contrast
-- rather than coverage — Energy and Technology have very different volatility
-- profiles, Healthcare is the defensive block, and crypto sits far out on the
-- risk axis. That spread is what makes the risk-vs-return view informative.
--
-- Idempotent: re-running updates metadata without touching price history.

INSERT INTO market.assets (ticker, name, asset_type, sector, source_symbol, coingecko_id) VALUES
    -- Technology
    ('AAPL',  'Apple Inc.',                 'stock',  'Technology',  NULL,      NULL),
    ('MSFT',  'Microsoft Corporation',      'stock',  'Technology',  NULL,      NULL),
    ('NVDA',  'NVIDIA Corporation',         'stock',  'Technology',  NULL,      NULL),
    ('GOOGL', 'Alphabet Inc. Class A',      'stock',  'Technology',  NULL,      NULL),
    -- Energy
    ('XOM',   'Exxon Mobil Corporation',    'stock',  'Energy',      NULL,      NULL),
    ('CVX',   'Chevron Corporation',        'stock',  'Energy',      NULL,      NULL),
    ('COP',   'ConocoPhillips',             'stock',  'Energy',      NULL,      NULL),
    -- Financials
    ('JPM',   'JPMorgan Chase & Co.',       'stock',  'Financials',  NULL,      NULL),
    ('GS',    'The Goldman Sachs Group',    'stock',  'Financials',  NULL,      NULL),
    ('BAC',   'Bank of America Corporation','stock',  'Financials',  NULL,      NULL),
    -- Healthcare
    ('JNJ',   'Johnson & Johnson',          'stock',  'Healthcare',  NULL,      NULL),
    ('UNH',   'UnitedHealth Group',         'stock',  'Healthcare',  NULL,      NULL),
    ('LLY',   'Eli Lilly and Company',      'stock',  'Healthcare',  NULL,      NULL),
    -- Crypto. source_symbol is the OHLCV provider's symbol; ticker stays clean
    -- for display and for the LLM to reason about.
    ('BTC',   'Bitcoin',                    'crypto', 'Crypto',      'BTC-USD', 'bitcoin'),
    ('ETH',   'Ethereum',                   'crypto', 'Crypto',      'ETH-USD', 'ethereum'),
    ('SOL',   'Solana',                     'crypto', 'Crypto',      'SOL-USD', 'solana')
ON CONFLICT (ticker) DO UPDATE SET
    name          = EXCLUDED.name,
    asset_type    = EXCLUDED.asset_type,
    sector        = EXCLUDED.sector,
    source_symbol = EXCLUDED.source_symbol,
    coingecko_id  = EXCLUDED.coingecko_id;
