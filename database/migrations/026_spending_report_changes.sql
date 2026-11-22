-- #205 Finished reports follow later entry changes. Safe to re-run.
-- Decision (2026-11-22, user): regenerate on change. When an expense entry dated inside a finished report's period
-- is added, edited or deleted, that report is rebuilt automatically. This replaces the "a report is a snapshot"
-- rule of 021 (decision 2026-11-16). A report also shows the change from the period before it, so an entry dated
-- in that earlier period changes the report too.
--
-- The trigger only marks the reports (`stale`); the API rebuilds stale reports before it lists or reads reports and
-- when it makes new ones. Marking in the trigger catches every writer (entry form, CSV import, classification, fixed
-- costs) without each of them calling the rebuild.
--
-- The trigger takes the reports' advisory lock in shared mode, and making or rebuilding reports takes it in
-- exclusive mode (backend/src/reports.ts). So an entry change either commits before a report is built, and the
-- build sees it, or waits until the build commits, and then marks the new report.

ALTER TABLE spending_reports
  ADD COLUMN IF NOT EXISTS stale boolean NOT NULL DEFAULT false,
  -- When the content was last rebuilt after an entry change; NULL while it is what was first made.
  ADD COLUMN IF NOT EXISTS rebuilt_at timestamptz;

CREATE OR REPLACE FUNCTION spending_reports_mark_stale() RETURNS trigger
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
  -- The report's own period, or the period before it (its "previous" total).
  UPDATE spending_reports r SET stale = true
  WHERE NOT r.stale
    AND EXISTS (
      SELECT 1 FROM unnest(dates) AS d
      WHERE d BETWEEN (r.start_date - CASE r.period WHEN 'week' THEN interval '7 days'
                                                   ELSE interval '1 month' END)::date
                  AND r.end_date
    );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_mark_reports_stale ON ledger_entries;
CREATE TRIGGER ledger_entries_mark_reports_stale
  AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION spending_reports_mark_stale();
