-- seed_assets.sql - the tracked universe.
--
-- 135 assets: 93 US equities across the 11 GICS sectors, 30 Indian equities
-- on the NSE, and 12 crypto.
-- Sector membership follows GICS, which is why GOOGL and META sit under
-- Communication Services and AMZN under Consumer Discretionary rather than
-- with the other large-cap tech names.
--
-- Every ticker here was verified to return a full 3-year history before being
-- added. MATIC-USD and POL-USD were excluded for that reason: Polygon rebranded
-- mid-window, leaving 582 and 72 bars respectively.
--
-- Idempotent: re-running updates metadata without touching price history.

INSERT INTO market.assets (ticker, name, asset_type, sector, source_symbol, coingecko_id, currency) VALUES
    -- Information Technology
    ('AAPL',  'Apple Inc.',                     'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('MSFT',  'Microsoft Corporation',          'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('NVDA',  'NVIDIA Corporation',             'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('AVGO',  'Broadcom Inc.',                  'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('ORCL',  'Oracle Corporation',             'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('CRM',   'Salesforce Inc.',                'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('AMD',   'Advanced Micro Devices Inc.',    'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('ADBE',  'Adobe Inc.',                     'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('CSCO',  'Cisco Systems Inc.',             'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('ACN',   'Accenture plc',                  'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('INTU',  'Intuit Inc.',                    'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('TXN',   'Texas Instruments Inc.',         'stock', 'Information Technology', NULL, NULL, 'USD'),
    ('QCOM',  'QUALCOMM Inc.',                  'stock', 'Information Technology', NULL, NULL, 'USD'),

    -- Communication Services
    ('GOOGL', 'Alphabet Inc.',                  'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('META',  'Meta Platforms Inc.',            'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('NFLX',  'Netflix Inc.',                   'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('DIS',   'The Walt Disney Company',        'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('CMCSA', 'Comcast Corporation',            'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('T',     'AT&T Inc.',                      'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('VZ',    'Verizon Communications Inc.',    'stock', 'Communication Services', NULL, NULL, 'USD'),
    ('TMUS',  'T-Mobile US Inc.',               'stock', 'Communication Services', NULL, NULL, 'USD'),

    -- Consumer Discretionary
    ('AMZN',  'Amazon.com Inc.',                'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('HD',    'The Home Depot Inc.',            'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('MCD',   'McDonalds Corporation',          'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('NKE',   'NIKE Inc.',                      'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('SBUX',  'Starbucks Corporation',          'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('TGT',   'Target Corporation',             'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('LOW',   'Lowes Companies Inc.',           'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),
    ('BKNG',  'Booking Holdings Inc.',          'stock', 'Consumer Discretionary', NULL, NULL, 'USD'),

    -- Consumer Staples
    ('PG',    'Procter & Gamble Company',       'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('KO',    'The Coca-Cola Company',          'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('PEP',   'PepsiCo Inc.',                   'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('WMT',   'Walmart Inc.',                   'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('COST',  'Costco Wholesale Corporation',   'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('PM',    'Philip Morris International',    'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('MO',    'Altria Group Inc.',              'stock', 'Consumer Staples',       NULL, NULL, 'USD'),
    ('CL',    'Colgate-Palmolive Company',      'stock', 'Consumer Staples',       NULL, NULL, 'USD'),

    -- Energy
    ('XOM',   'Exxon Mobil Corporation',        'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('CVX',   'Chevron Corporation',            'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('COP',   'ConocoPhillips',                 'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('SLB',   'Schlumberger N.V.',              'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('EOG',   'EOG Resources Inc.',             'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('PSX',   'Phillips 66',                    'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('MPC',   'Marathon Petroleum Corporation', 'stock', 'Energy',                 NULL, NULL, 'USD'),
    ('OXY',   'Occidental Petroleum Corp.',     'stock', 'Energy',                 NULL, NULL, 'USD'),

    -- Financials
    ('JPM',   'JPMorgan Chase & Co.',           'stock', 'Financials',             NULL, NULL, 'USD'),
    ('GS',    'The Goldman Sachs Group Inc.',   'stock', 'Financials',             NULL, NULL, 'USD'),
    ('BAC',   'Bank of America Corporation',    'stock', 'Financials',             NULL, NULL, 'USD'),
    ('MS',    'Morgan Stanley',                 'stock', 'Financials',             NULL, NULL, 'USD'),
    ('WFC',   'Wells Fargo & Company',          'stock', 'Financials',             NULL, NULL, 'USD'),
    ('C',     'Citigroup Inc.',                 'stock', 'Financials',             NULL, NULL, 'USD'),
    ('SCHW',  'The Charles Schwab Corporation', 'stock', 'Financials',             NULL, NULL, 'USD'),
    ('BLK',   'BlackRock Inc.',                 'stock', 'Financials',             NULL, NULL, 'USD'),
    ('SPGI',  'S&P Global Inc.',                'stock', 'Financials',             NULL, NULL, 'USD'),
    ('AXP',   'American Express Company',       'stock', 'Financials',             NULL, NULL, 'USD'),

    -- Health Care
    ('JNJ',   'Johnson & Johnson',              'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('UNH',   'UnitedHealth Group Inc.',        'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('LLY',   'Eli Lilly and Company',          'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('ABBV',  'AbbVie Inc.',                    'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('MRK',   'Merck & Co. Inc.',               'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('PFE',   'Pfizer Inc.',                    'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('TMO',   'Thermo Fisher Scientific Inc.',  'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('ABT',   'Abbott Laboratories',            'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('DHR',   'Danaher Corporation',            'stock', 'Health Care',            NULL, NULL, 'USD'),
    ('AMGN',  'Amgen Inc.',                     'stock', 'Health Care',            NULL, NULL, 'USD'),

    -- Industrials
    ('CAT',   'Caterpillar Inc.',               'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('BA',    'The Boeing Company',             'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('HON',   'Honeywell International Inc.',   'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('UNP',   'Union Pacific Corporation',      'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('GE',    'GE Aerospace',                   'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('LMT',   'Lockheed Martin Corporation',    'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('DE',    'Deere & Company',                'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('MMM',   '3M Company',                     'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('UPS',   'United Parcel Service Inc.',     'stock', 'Industrials',            NULL, NULL, 'USD'),
    ('RTX',   'RTX Corporation',                'stock', 'Industrials',            NULL, NULL, 'USD'),

    -- Materials
    ('LIN',   'Linde plc',                      'stock', 'Materials',              NULL, NULL, 'USD'),
    ('SHW',   'The Sherwin-Williams Company',   'stock', 'Materials',              NULL, NULL, 'USD'),
    ('APD',   'Air Products and Chemicals',     'stock', 'Materials',              NULL, NULL, 'USD'),
    ('ECL',   'Ecolab Inc.',                    'stock', 'Materials',              NULL, NULL, 'USD'),
    ('NEM',   'Newmont Corporation',            'stock', 'Materials',              NULL, NULL, 'USD'),
    ('FCX',   'Freeport-McMoRan Inc.',          'stock', 'Materials',              NULL, NULL, 'USD'),

    -- Real Estate
    ('PLD',   'Prologis Inc.',                  'stock', 'Real Estate',            NULL, NULL, 'USD'),
    ('AMT',   'American Tower Corporation',     'stock', 'Real Estate',            NULL, NULL, 'USD'),
    ('EQIX',  'Equinix Inc.',                   'stock', 'Real Estate',            NULL, NULL, 'USD'),
    ('SPG',   'Simon Property Group Inc.',      'stock', 'Real Estate',            NULL, NULL, 'USD'),
    ('O',     'Realty Income Corporation',      'stock', 'Real Estate',            NULL, NULL, 'USD'),
    ('CCI',   'Crown Castle Inc.',              'stock', 'Real Estate',            NULL, NULL, 'USD'),

    -- Utilities
    ('NEE',   'NextEra Energy Inc.',            'stock', 'Utilities',              NULL, NULL, 'USD'),
    ('DUK',   'Duke Energy Corporation',        'stock', 'Utilities',              NULL, NULL, 'USD'),
    ('SO',    'The Southern Company',           'stock', 'Utilities',              NULL, NULL, 'USD'),
    ('D',     'Dominion Energy Inc.',           'stock', 'Utilities',              NULL, NULL, 'USD'),
    ('AEP',   'American Electric Power Co.',    'stock', 'Utilities',              NULL, NULL, 'USD'),
    ('EXC',   'Exelon Corporation',             'stock', 'Utilities',              NULL, NULL, 'USD'),

    -- Crypto. source_symbol maps to the OHLCV provider; coingecko_id drives the
    -- market-cap pass and is required by the assets_coingecko_id_matches_type CHECK.
    ('BTC',   'Bitcoin',                        'crypto', 'Crypto', 'BTC-USD',  'bitcoin', 'USD'),
    ('ETH',   'Ethereum',                       'crypto', 'Crypto', 'ETH-USD',  'ethereum', 'USD'),
    ('SOL',   'Solana',                         'crypto', 'Crypto', 'SOL-USD',  'solana', 'USD'),
    ('XRP',   'XRP',                            'crypto', 'Crypto', 'XRP-USD',  'ripple', 'USD'),
    ('ADA',   'Cardano',                        'crypto', 'Crypto', 'ADA-USD',  'cardano', 'USD'),
    ('DOGE',  'Dogecoin',                       'crypto', 'Crypto', 'DOGE-USD', 'dogecoin', 'USD'),
    ('AVAX',  'Avalanche',                      'crypto', 'Crypto', 'AVAX-USD', 'avalanche-2', 'USD'),
    ('LINK',  'Chainlink',                      'crypto', 'Crypto', 'LINK-USD', 'chainlink', 'USD'),
    ('DOT',   'Polkadot',                       'crypto', 'Crypto', 'DOT-USD',  'polkadot', 'USD'),
    ('LTC',   'Litecoin',                       'crypto', 'Crypto', 'LTC-USD',  'litecoin', 'USD'),
    ('BCH',   'Bitcoin Cash',                   'crypto', 'Crypto', 'BCH-USD',  'bitcoin-cash', 'USD'),
    ('TRX',   'TRON',                           'crypto', 'Crypto', 'TRX-USD',  'tron', 'USD'),

    -- ----------------------------------------------------------------
    -- India (NSE). Fetched via yfinance with a .NS suffix, so source_symbol
    -- carries the mapping and no new provider is needed.
    --
    -- currency is INR. Returns are percentage changes in the LOCAL currency,
    -- so an India sector index is a valid local-currency series - but
    -- comparing it against a USD sector conflates asset performance with the
    -- INR/USD rate. Sectors are prefixed so no chart silently does that.
    --
    -- NSE trades 745 days over this window against the US 753, with 718
    -- overlapping. correlation_matrix.sql already intersects on common dates.
    -- ----------------------------------------------------------------
    ('TCS', 'Tata Consultancy Services', 'stock', 'India: IT', 'TCS.NS', NULL, 'INR'),
    ('INFY', 'Infosys Limited', 'stock', 'India: IT', 'INFY.NS', NULL, 'INR'),
    ('WIPRO', 'Wipro Limited', 'stock', 'India: IT', 'WIPRO.NS', NULL, 'INR'),
    ('HCLTECH', 'HCL Technologies', 'stock', 'India: IT', 'HCLTECH.NS', NULL, 'INR'),
    ('TECHM', 'Tech Mahindra', 'stock', 'India: IT', 'TECHM.NS', NULL, 'INR'),
    ('HDFCBANK', 'HDFC Bank Limited', 'stock', 'India: Financials', 'HDFCBANK.NS', NULL, 'INR'),
    ('ICICIBANK', 'ICICI Bank Limited', 'stock', 'India: Financials', 'ICICIBANK.NS', NULL, 'INR'),
    ('SBIN', 'State Bank of India', 'stock', 'India: Financials', 'SBIN.NS', NULL, 'INR'),
    ('KOTAKBANK', 'Kotak Mahindra Bank', 'stock', 'India: Financials', 'KOTAKBANK.NS', NULL, 'INR'),
    ('AXISBANK', 'Axis Bank Limited', 'stock', 'India: Financials', 'AXISBANK.NS', NULL, 'INR'),
    ('BAJFINANCE', 'Bajaj Finance Limited', 'stock', 'India: Financials', 'BAJFINANCE.NS', NULL, 'INR'),
    ('RELIANCE', 'Reliance Industries', 'stock', 'India: Energy', 'RELIANCE.NS', NULL, 'INR'),
    ('ONGC', 'Oil & Natural Gas Corp.', 'stock', 'India: Energy', 'ONGC.NS', NULL, 'INR'),
    ('IOC', 'Indian Oil Corporation', 'stock', 'India: Energy', 'IOC.NS', NULL, 'INR'),
    ('BPCL', 'Bharat Petroleum Corp.', 'stock', 'India: Energy', 'BPCL.NS', NULL, 'INR'),
    ('ITC', 'ITC Limited', 'stock', 'India: Consumer', 'ITC.NS', NULL, 'INR'),
    ('HINDUNILVR', 'Hindustan Unilever', 'stock', 'India: Consumer', 'HINDUNILVR.NS', NULL, 'INR'),
    ('MARUTI', 'Maruti Suzuki India', 'stock', 'India: Consumer', 'MARUTI.NS', NULL, 'INR'),
    ('TITAN', 'Titan Company Limited', 'stock', 'India: Consumer', 'TITAN.NS', NULL, 'INR'),
    ('NESTLEIND', 'Nestle India Limited', 'stock', 'India: Consumer', 'NESTLEIND.NS', NULL, 'INR'),
    ('LT', 'Larsen & Toubro', 'stock', 'India: Industrials', 'LT.NS', NULL, 'INR'),
    ('ADANIENT', 'Adani Enterprises', 'stock', 'India: Industrials', 'ADANIENT.NS', NULL, 'INR'),
    ('TATASTEEL', 'Tata Steel Limited', 'stock', 'India: Industrials', 'TATASTEEL.NS', NULL, 'INR'),
    ('JSWSTEEL', 'JSW Steel Limited', 'stock', 'India: Industrials', 'JSWSTEEL.NS', NULL, 'INR'),
    ('SUNPHARMA', 'Sun Pharmaceutical', 'stock', 'India: Pharma', 'SUNPHARMA.NS', NULL, 'INR'),
    ('DRREDDY', 'Dr. Reddys Laboratories', 'stock', 'India: Pharma', 'DRREDDY.NS', NULL, 'INR'),
    ('CIPLA', 'Cipla Limited', 'stock', 'India: Pharma', 'CIPLA.NS', NULL, 'INR'),
    ('NTPC', 'NTPC Limited', 'stock', 'India: Utilities', 'NTPC.NS', NULL, 'INR'),
    ('POWERGRID', 'Power Grid Corp. of India', 'stock', 'India: Utilities', 'POWERGRID.NS', NULL, 'INR'),
    ('TATAPOWER', 'Tata Power Company', 'stock', 'India: Utilities', 'TATAPOWER.NS', NULL, 'INR')
ON CONFLICT (ticker) DO UPDATE SET
    name          = EXCLUDED.name,
    asset_type    = EXCLUDED.asset_type,
    sector        = EXCLUDED.sector,
    source_symbol = EXCLUDED.source_symbol,
    coingecko_id  = EXCLUDED.coingecko_id,
    currency      = EXCLUDED.currency;
