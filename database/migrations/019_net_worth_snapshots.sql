-- #49 Net worth by day. Safe to re-run.
-- Decisions (2026-11-10): the app saves today's values (Seoul) once when it opens, and "지금 값으로 저장" saves
-- them again; a day keeps one row, the latest save. The values are the asset screen's totals on that day
-- (depreciating and prepaid assets at their current value); past days are never computed again.

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  snapshot_date date PRIMARY KEY,
  assets_krw bigint NOT NULL,
  debts_krw bigint NOT NULL,
  net_krw bigint NOT NULL,
  -- Assets and debts left out of the totals that day (no price, no USD rate, no value).
  uncounted integer NOT NULL DEFAULT 0,
  saved_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'net_worth_snapshots_values_check') THEN
    ALTER TABLE net_worth_snapshots ADD CONSTRAINT net_worth_snapshots_values_check
      CHECK (net_krw = assets_krw - debts_krw AND uncounted >= 0);
  END IF;
END $$;
