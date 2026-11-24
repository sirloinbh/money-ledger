-- #310 Mock investing v2: the morning "keep or sell" question for each long hold. Safe to re-run.

-- One question per long hold position per trading day. status:
--   open        asked, no answer yet (closes at 15:00 KST)
--   kept        answered keep, or no answer by 15:00 (answer_source 'auto')
--   sell_queued answered sell before 09:00 (or the sale could not fill yet); sold when the market is open
--   sold        the position was sold at the best bid
--   expired     a sale that never filled before the market closed
CREATE TABLE IF NOT EXISTS mock_position_questions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES mock_positions (id),
  question_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'sell_queued', 'sold', 'expired')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answer_source text CHECK (answer_source IN ('web', 'kakao', 'auto')),
  UNIQUE (position_id, question_date)
);

CREATE INDEX IF NOT EXISTS mock_position_questions_day_idx ON mock_position_questions (question_date, status);

-- Days the KRX is closed on a weekday. Weekends are not listed. Kept by hand (there is no holiday source yet):
-- add the KRX calendar's closures here each year. A missing day only means a question is asked on a closed day,
-- and a sell answer then waits until the market opens.
CREATE TABLE IF NOT EXISTS krx_holidays (
  holiday_date date PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO krx_holidays (holiday_date, name) VALUES
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-31', 'Year-end market closure'),
  ('2027-01-01', 'New Year''s Day')
ON CONFLICT DO NOTHING;
