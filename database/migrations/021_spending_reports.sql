-- #62 Weekly and monthly spending reports. Safe to re-run.
-- Decisions (2026-11-16): opening the app saves the report of each finished week (Sunday to Saturday) and month in
-- Asia/Seoul. A report is a snapshot: it keeps what it said when it was made, and later edits to entries do not
-- change it. One report per period; the app shows a notice until the report is opened (seen_at).

CREATE TABLE IF NOT EXISTS spending_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL CHECK (period IN ('week', 'month')),
  -- The first day of the period: a Sunday for a week, the 1st for a month.
  start_date date NOT NULL,
  -- The last day of the period, included.
  end_date date NOT NULL,
  -- Totals, the change from the previous period, the top categories and (monthly) the overspending, as text
  -- amounts so they stay exact.
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  CONSTRAINT spending_reports_period_key UNIQUE (period, start_date),
  CONSTRAINT spending_reports_week_check CHECK (
    period <> 'week' OR (extract(dow FROM start_date) = 0 AND end_date = start_date + 6)
  ),
  CONSTRAINT spending_reports_month_check CHECK (
    period <> 'month' OR (
      start_date = date_trunc('month', start_date)::date
      AND end_date = (start_date + interval '1 month' - interval '1 day')::date
    )
  )
);
