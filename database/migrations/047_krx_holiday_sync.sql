-- #321 Where each krx_holidays row came from, and when the calendar was last filled. Safe to re-run.
-- source: 'manual' (added by hand, never touched by the sync), 'rule' (a KRX-only closure computed by the app:
-- Labour Day and the last business day of the year), 'kis' (read from KIS 국내휴장일조회).
ALTER TABLE krx_holidays ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'krx_holidays_source_check') THEN
    ALTER TABLE krx_holidays ADD CONSTRAINT krx_holidays_source_check
      CHECK (source IN ('manual', 'rule', 'kis'));
  END IF;
END $$;

-- One row: when KIS was last read successfully and how far ahead it covered.
CREATE TABLE IF NOT EXISTS krx_holiday_sync (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  synced_at timestamptz NOT NULL,
  covered_through date NOT NULL
);
