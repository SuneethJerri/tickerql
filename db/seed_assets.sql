-- seed_assets.sql - the tracked universe.
--
-- 105 assets: 93 equities across the 11 GICS sectors, plus 12 crypto.
-- Sector membership follows GICS, which is why GOOGL and META sit under
-- Communication Services and AMZN under Consumer Discretionary rather than
-- with the other large-cap tech names.
--
-- Every ticker here was verified to return a full 3-year history before being
-- added. MATIC-USD and POL-USD were excluded for that reason: Polygon rebranded
-- mid-window, leaving 582 and 72 bars respectively.
--
-- Idempotent: re-running updates metadata without touching price history.

INSERT INTO market.assets (ticker, name, asset_type, sector, source_symbol, coingecko_id) VALUES
    -- Information Technology
    ('AAPL',  'Apple Inc.',                     'stock', 'Information Technology', NULL, NULL),
    ('MSFT',  'Microsoft Corporation',          'stock', 'Information Technology', NULL, NULL),
    ('NVDA',  'NVIDIA Corporation',             'stock', 'Information Technology', NULL, NULL),
    ('AVGO',  'Broadcom Inc.',                  'stock', 'Information Technology', NULL, NULL),
    ('ORCL',  'Oracle Corporation',             'stock', 'Information Technology', NULL, NULL),
    ('CRM',   'Salesforce Inc.',                'stock', 'Information Technology', NULL, NULL),
    ('AMD',   'Advanced Micro Devices Inc.',    'stock', 'Information Technology', NULL, NULL),
    ('ADBE',  'Adobe Inc.',                     'stock', 'Information Technology', NULL, NULL),
    ('CSCO',  'Cisco Systems Inc.',             'stock', 'Information Technology', NULL, NULL),
    ('ACN',   'Accenture plc',                  'stock', 'Information Technology', NULL, NULL),
    ('INTU',  'Intuit Inc.',                    'stock', 'Information Technology', NULL, NULL),
    ('TXN',   'Texas Instruments Inc.',         'stock', 'Information Technology', NULL, NULL),
    ('QCOM',  'QUALCOMM Inc.',                  'stock', 'Information Technology', NULL, NULL),

    -- Communication Services
    ('GOOGL', 'Alphabet Inc.',                  'stock', 'Communication Services', NULL, NULL),
    ('META',  'Meta Platforms Inc.',            'stock', 'Communication Services', NULL, NULL),
    ('NFLX',  'Netflix Inc.',                   'stock', 'Communication Services', NULL, NULL),
    ('DIS',   'The Walt Disney Company',        'stock', 'Communication Services', NULL, NULL),
    ('CMCSA', 'Comcast Corporation',            'stock', 'Communication Services', NULL, NULL),
    ('T',     'AT&T Inc.',                      'stock', 'Communication Services', NULL, NULL),
    ('VZ',    'Verizon Communications Inc.',    'stock', 'Communication Services', NULL, NULL),
    ('TMUS',  'T-Mobile US Inc.',               'stock', 'Communication Services', NULL, NULL),

    -- Consumer Discretionary
    ('AMZN',  'Amazon.com Inc.',                'stock', 'Consumer Discretionary', NULL, NULL),
    ('HD',    'The Home Depot Inc.',            'stock', 'Consumer Discretionary', NULL, NULL),
    ('MCD',   'McDonalds Corporation',          'stock', 'Consumer Discretionary', NULL, NULL),
    ('NKE',   'NIKE Inc.',                      'stock', 'Consumer Discretionary', NULL, NULL),
    ('SBUX',  'Starbucks Corporation',          'stock', 'Consumer Discretionary', NULL, NULL),
    ('TGT',   'Target Corporation',             'stock', 'Consumer Discretionary', NULL, NULL),
    ('LOW',   'Lowes Companies Inc.',           'stock', 'Consumer Discretionary', NULL, NULL),
    ('BKNG',  'Booking Holdings Inc.',          'stock', 'Consumer Discretionary', NULL, NULL),

    -- Consumer Staples
    ('PG',    'Procter & Gamble Company',       'stock', 'Consumer Staples',       NULL, NULL),
    ('KO',    'The Coca-Cola Company',          'stock', 'Consumer Staples',       NULL, NULL),
    ('PEP',   'PepsiCo Inc.',                   'stock', 'Consumer Staples',       NULL, NULL),
    ('WMT',   'Walmart Inc.',                   'stock', 'Consumer Staples',       NULL, NULL),
    ('COST',  'Costco Wholesale Corporation',   'stock', 'Consumer Staples',       NULL, NULL),
    ('PM',    'Philip Morris International',    'stock', 'Consumer Staples',       NULL, NULL),
    ('MO',    'Altria Group Inc.',              'stock', 'Consumer Staples',       NULL, NULL),
    ('CL',    'Colgate-Palmolive Company',      'stock', 'Consumer Staples',       NULL, NULL),

    -- Energy
    ('XOM',   'Exxon Mobil Corporation',        'stock', 'Energy',                 NULL, NULL),
    ('CVX',   'Chevron Corporation',            'stock', 'Energy',                 NULL, NULL),
    ('COP',   'ConocoPhillips',                 'stock', 'Energy',                 NULL, NULL),
    ('SLB',   'Schlumberger N.V.',              'stock', 'Energy',                 NULL, NULL),
    ('EOG',   'EOG Resources Inc.',             'stock', 'Energy',                 NULL, NULL),
    ('PSX',   'Phillips 66',                    'stock', 'Energy',                 NULL, NULL),
    ('MPC',   'Marathon Petroleum Corporation', 'stock', 'Energy',                 NULL, NULL),
    ('OXY',   'Occidental Petroleum Corp.',     'stock', 'Energy',                 NULL, NULL),

    -- Financials
    ('JPM',   'JPMorgan Chase & Co.',           'stock', 'Financials',             NULL, NULL),
    ('GS',    'The Goldman Sachs Group Inc.',   'stock', 'Financials',             NULL, NULL),
    ('BAC',   'Bank of America Corporation',    'stock', 'Financials',             NULL, NULL),
    ('MS',    'Morgan Stanley',                 'stock', 'Financials',             NULL, NULL),
    ('WFC',   'Wells Fargo & Company',          'stock', 'Financials',             NULL, NULL),
    ('C',     'Citigroup Inc.',                 'stock', 'Financials',             NULL, NULL),
    ('SCHW',  'The Charles Schwab Corporation', 'stock', 'Financials',             NULL, NULL),
    ('BLK',   'BlackRock Inc.',                 'stock', 'Financials',             NULL, NULL),
    ('SPGI',  'S&P Global Inc.',                'stock', 'Financials',             NULL, NULL),
    ('AXP',   'American Express Company',       'stock', 'Financials',             NULL, NULL),

    -- Health Care
    ('JNJ',   'Johnson & Johnson',              'stock', 'Health Care',            NULL, NULL),
    ('UNH',   'UnitedHealth Group Inc.',        'stock', 'Health Care',            NULL, NULL),
    ('LLY',   'Eli Lilly and Company',          'stock', 'Health Care',            NULL, NULL),
    ('ABBV',  'AbbVie Inc.',                    'stock', 'Health Care',            NULL, NULL),
    ('MRK',   'Merck & Co. Inc.',               'stock', 'Health Care',            NULL, NULL),
    ('PFE',   'Pfizer Inc.',                    'stock', 'Health Care',            NULL, NULL),
    ('TMO',   'Thermo Fisher Scientific Inc.',  'stock', 'Health Care',            NULL, NULL),
    ('ABT',   'Abbott Laboratories',            'stock', 'Health Care',            NULL, NULL),
    ('DHR',   'Danaher Corporation',            'stock', 'Health Care',            NULL, NULL),
    ('AMGN',  'Amgen Inc.',                     'stock', 'Health Care',            NULL, NULL),

    -- Industrials
    ('CAT',   'Caterpillar Inc.',               'stock', 'Industrials',            NULL, NULL),
    ('BA',    'The Boeing Company',             'stock', 'Industrials',            NULL, NULL),
    ('HON',   'Honeywell International Inc.',   'stock', 'Industrials',            NULL, NULL),
    ('UNP',   'Union Pacific Corporation',      'stock', 'Industrials',            NULL, NULL),
    ('GE',    'GE Aerospace',                   'stock', 'Industrials',            NULL, NULL),
    ('LMT',   'Lockheed Martin Corporation',    'stock', 'Industrials',            NULL, NULL),
    ('DE',    'Deere & Company',                'stock', 'Industrials',            NULL, NULL),
    ('MMM',   '3M Company',                     'stock', 'Industrials',            NULL, NULL),
    ('UPS',   'United Parcel Service Inc.',     'stock', 'Industrials',            NULL, NULL),
    ('RTX',   'RTX Corporation',                'stock', 'Industrials',            NULL, NULL),

    -- Materials
    ('LIN',   'Linde plc',                      'stock', 'Materials',              NULL, NULL),
    ('SHW',   'The Sherwin-Williams Company',   'stock', 'Materials',              NULL, NULL),
    ('APD',   'Air Products and Chemicals',     'stock', 'Materials',              NULL, NULL),
    ('ECL',   'Ecolab Inc.',                    'stock', 'Materials',              NULL, NULL),
    ('NEM',   'Newmont Corporation',            'stock', 'Materials',              NULL, NULL),
    ('FCX',   'Freeport-McMoRan Inc.',          'stock', 'Materials',              NULL, NULL),

    -- Real Estate
    ('PLD',   'Prologis Inc.',                  'stock', 'Real Estate',            NULL, NULL),
    ('AMT',   'American Tower Corporation',     'stock', 'Real Estate',            NULL, NULL),
    ('EQIX',  'Equinix Inc.',                   'stock', 'Real Estate',            NULL, NULL),
    ('SPG',   'Simon Property Group Inc.',      'stock', 'Real Estate',            NULL, NULL),
    ('O',     'Realty Income Corporation',      'stock', 'Real Estate',            NULL, NULL),
    ('CCI',   'Crown Castle Inc.',              'stock', 'Real Estate',            NULL, NULL),

    -- Utilities
    ('NEE',   'NextEra Energy Inc.',            'stock', 'Utilities',              NULL, NULL),
    ('DUK',   'Duke Energy Corporation',        'stock', 'Utilities',              NULL, NULL),
    ('SO',    'The Southern Company',           'stock', 'Utilities',              NULL, NULL),
    ('D',     'Dominion Energy Inc.',           'stock', 'Utilities',              NULL, NULL),
    ('AEP',   'American Electric Power Co.',    'stock', 'Utilities',              NULL, NULL),
    ('EXC',   'Exelon Corporation',             'stock', 'Utilities',              NULL, NULL),

    -- Crypto. source_symbol maps to the OHLCV provider; coingecko_id drives the
    -- market-cap pass and is required by the assets_coingecko_id_matches_type CHECK.
    ('BTC',   'Bitcoin',                        'crypto', 'Crypto', 'BTC-USD',  'bitcoin'),
    ('ETH',   'Ethereum',                       'crypto', 'Crypto', 'ETH-USD',  'ethereum'),
    ('SOL',   'Solana',                         'crypto', 'Crypto', 'SOL-USD',  'solana'),
    ('XRP',   'XRP',                            'crypto', 'Crypto', 'XRP-USD',  'ripple'),
    ('ADA',   'Cardano',                        'crypto', 'Crypto', 'ADA-USD',  'cardano'),
    ('DOGE',  'Dogecoin',                       'crypto', 'Crypto', 'DOGE-USD', 'dogecoin'),
    ('AVAX',  'Avalanche',                      'crypto', 'Crypto', 'AVAX-USD', 'avalanche-2'),
    ('LINK',  'Chainlink',                      'crypto', 'Crypto', 'LINK-USD', 'chainlink'),
    ('DOT',   'Polkadot',                       'crypto', 'Crypto', 'DOT-USD',  'polkadot'),
    ('LTC',   'Litecoin',                       'crypto', 'Crypto', 'LTC-USD',  'litecoin'),
    ('BCH',   'Bitcoin Cash',                   'crypto', 'Crypto', 'BCH-USD',  'bitcoin-cash'),
    ('TRX',   'TRON',                           'crypto', 'Crypto', 'TRX-USD',  'tron')
ON CONFLICT (ticker) DO UPDATE SET
    name          = EXCLUDED.name,
    asset_type    = EXCLUDED.asset_type,
    sector        = EXCLUDED.sector,
    source_symbol = EXCLUDED.source_symbol,
    coingecko_id  = EXCLUDED.coingecko_id;
