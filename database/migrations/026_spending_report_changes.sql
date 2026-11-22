-- #205 Finished reports follow later entry changes. Safe to re-run.
-- Decision (2026-11-22, user): regenerate on change. When an expense entry dated inside a finished report's period
-- is added, edited or deleted, that report is rebuilt automatically. This replaces the "a report is a snapshot"
-- rule of 021 (decision 2026-11-16). A report also shows the change from the period before it, so an entry dated
-- in that earlier period changes the report too.
--
-- A trigger writes the date of each such change to spending_report_changes; the API rebuilds the reports those
-- dates touch before it lists or reads reports and when it makes new ones, then clears the log. Logging in the
-- trigger catches every writer (entry form, CSV import, classification, fixed costs) without each of them calling
-- the rebuild. The log is insert-only, so two entry transactions never wait for each other on it (marking report
-- rows instead could deadlock two imports that touch the same reports in a different order).
--
-- The trigger takes the reports' advisory lock in shared mode, and making or rebuilding reports takes it in
-- exclusive mode (backend/src/reports.ts). So an entry change either commits before a report is built, and the
-- build sees it, or waits until the build commits, and is then logged against the new report.

-- When the content was last rebuilt after an entry change; NULL while it is what was first made.
ALTER TABLE spending_reports ADD COLUMN IF NOT EXISTS rebuilt_at timestamptz;

-- Dates of expense entry changes that touch a saved report and are not rebuilt into it yet.
CREATE TABLE IF NOT EXISTS spending_report_changes (
  entry_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION spending_reports_log_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dates date[] := '{}';
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.entry_date, OLD.kind, OLD.amount, OLD.category_id)
      IS NOT DISTINCT FROM (NEW.entry_date, NEW.kind, NEW.amount, NEW.category_id) THEN
    RETURN NULL; -- a memo or another column does not move any number of a report
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.kind = 'expense' THEN
    dates := dates || OLD.entry_date;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.kind = 'expense' THEN
    dates := dates || NEW.entry_date;
  END IF;
  IF cardinality(dates) = 0 THEN
    RETURN NULL; -- income does not count in a spending report
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtext('spending_reports'));
  -- Only dates in a saved report's period or the period before it (its "previous" total): an entry of the
  -- running week or month is left out until that period has a report.
  INSERT INTO spending_report_changes (entry_date)
  SELECT DISTINCT d FROM unnest(dates) AS d
  WHERE EXISTS (
    SELECT 1 FROM spending_reports r
    WHERE d BETWEEN (r.start_date - CASE r.period WHEN 'week' THEN interval '7 days'
                                                 ELSE interval '1 month' END)::date
                AND r.end_date
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_log_report_change ON ledger_entries;
CREATE TRIGGER ledger_entries_log_report_change
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION spending_reports_log_change();
