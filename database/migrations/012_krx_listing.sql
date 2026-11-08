-- #97 Korean securities that left the KRX daily data (delisted or suspended). Safe to re-run.
-- A market day is a day the market's KRX answer was not empty. A security missing from 10 market days in a
-- row becomes inactive: hidden from search and not buyable (selling is still allowed). It becomes active again
-- when it shows up in the data (2026-11-08 decision).

-- The last KRX market day each Korean security appeared on. NULL for US securities.
ALTER TABLE securities ADD COLUMN IF NOT EXISTS krx_last_seen date;

-- The days each KRX market had data, so "10 market days" is counted the same way however often a day is saved.
CREATE TABLE IF NOT EXISTS krx_market_days (
  market text NOT NULL CHECK (market IN ('KOSPI', 'KOSDAQ', 'KRX_ETF')),
  trade_date date NOT NULL,
  PRIMARY KEY (market, trade_date)
);

-- Rows saved before this migration: their market days and last-seen days come from the stored closes.
INSERT INTO krx_market_days (market, trade_date)
SELECT DISTINCT s.market, p.trade_date
FROM security_prices p JOIN securities s ON s.id = p.security_id
WHERE s.currency = 'KRW'
ON CONFLICT DO NOTHING;

UPDATE securities s SET krx_last_seen = latest.trade_date
FROM (SELECT security_id, max(trade_date) AS trade_date FROM security_prices GROUP BY security_id) latest
WHERE s.id = latest.security_id AND s.currency = 'KRW' AND s.krx_last_seen IS NULL;
