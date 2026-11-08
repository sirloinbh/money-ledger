-- #51 Shared price store: securities, daily closes, USD/KRW rates and the fetch bookkeeping. Safe to re-run.
-- Sources and schedule follow docs/price-source.md (#36). Mock trading (#52-#54) and portfolio current
-- prices (#47) both read from these tables, so nothing here is specific to mock trading.

-- Korean securities come from the KRX daily trading data (every listed stock and ETF), US ones from the
-- Tiingo supported-tickers file (NYSE, NASDAQ, NYSE ARCA stocks and ETFs). Rows are never deleted: prices,
-- orders and holdings point at them. A US ticker that leaves the file is only marked inactive.
CREATE TABLE IF NOT EXISTS securities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market text NOT NULL CHECK (market IN ('KOSPI', 'KOSDAQ', 'KRX_ETF', 'NYSE', 'NASDAQ', 'NYSE_ARCA')),
  -- KRX short codes (005930, 0001A0) and Tiingo tickers (AAPL, BRK-A), upper case.
  symbol text NOT NULL CHECK (symbol ~ '^[0-9A-Z][0-9A-Z.-]{0,15}$'),
  -- The Tiingo file has no names: a US name is filled in when its detail screen is first opened.
  name text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('stock', 'etf')),
  currency text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  active boolean NOT NULL DEFAULT true,
  -- Last time the detail screen was opened. US securities opened in the last 30 days are fetched daily.
  viewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT securities_market_currency_check
    CHECK ((currency = 'KRW') = (market IN ('KOSPI', 'KOSDAQ', 'KRX_ETF'))),
  -- KRW means Korea and USD means the US, so a symbol is unique within its currency.
  CONSTRAINT securities_symbol_key UNIQUE (currency, symbol),
  -- Lets security_prices check that a close is in the security's own currency.
  CONSTRAINT securities_id_currency_key UNIQUE (id, currency)
);

CREATE INDEX IF NOT EXISTS securities_viewed_idx ON securities (viewed_at) WHERE viewed_at IS NOT NULL;

-- One close per security and trading day (the US trading day for US securities). A later fetch of the
-- same day overwrites it. Unadjusted close (Tiingo `close`, not `adjClose`).
CREATE TABLE IF NOT EXISTS security_prices (
  security_id bigint NOT NULL,
  trade_date date NOT NULL,
  close numeric(20,4) NOT NULL CHECK (close > 0),
  currency text NOT NULL CHECK (currency IN ('KRW', 'USD')),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (security_id, trade_date),
  CONSTRAINT security_prices_security_fkey
    FOREIGN KEY (security_id, currency) REFERENCES securities (id, currency),
  CONSTRAINT security_prices_krw_whole_check CHECK (currency <> 'KRW' OR close = trunc(close))
);

-- Korea Eximbank deal base rate: won per 1 USD on each business day it was published.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency text NOT NULL CHECK (currency = 'USD'),
  rate_date date NOT NULL,
  fx_rate numeric(12,4) NOT NULL CHECK (fx_rate > 0),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);

-- What each fetch has covered. `checked_through` is the last date that returned values or was recorded as
-- "no new values" (holiday), so the next run asks from the day after. Scopes: a KRX market, 'USD' for the
-- rate, a US ticker, 'tickers' for the weekly US list, and 'all' for the daily job itself.
CREATE TABLE IF NOT EXISTS price_fetch_state (
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 40),
  checked_through date,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  -- Korean message of the last failure, cleared on success. Never holds keys or URLs.
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  PRIMARY KEY (source, scope)
);

-- Calls to rate-limited sources (Tiingo: 50 per hour), so the limit holds across restarts.
CREATE TABLE IF NOT EXISTS price_api_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_api_calls_recent_idx ON price_api_calls (source, called_at);
