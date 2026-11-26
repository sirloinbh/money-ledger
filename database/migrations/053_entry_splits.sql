-- #292 Split one payment into parts, each with its own category and amount. Safe to re-run.
-- An entry with splits keeps its own total (`ledger_entries.amount`); its parts must add up to it exactly. The entry's
-- own category_id is then the category of its largest part, so lists and rules that read it keep working.
-- Category totals read the parts through the view `ledger_entry_parts` (the splits, or the entry itself when it has none).
CREATE TABLE IF NOT EXISTS ledger_entry_splits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES ledger_entries (id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position >= 1),
  -- Only expenses are split. The kind column with the foreign key keeps the category an expense category.
  kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
  category_id bigint NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  CONSTRAINT ledger_entry_splits_entry_position_key UNIQUE (entry_id, position),
  CONSTRAINT ledger_entry_splits_category_fkey FOREIGN KEY (category_id, kind)
    REFERENCES ledger_categories (id, kind)
);

CREATE INDEX IF NOT EXISTS ledger_entry_splits_category_idx ON ledger_entry_splits (category_id);

-- The parts of every entry: its splits, or the entry as one part. Category totals group over this.
CREATE OR REPLACE VIEW ledger_entry_parts AS
  SELECT e.id AS entry_id, e.entry_date, e.kind, s.category_id, s.amount
  FROM ledger_entries e JOIN ledger_entry_splits s ON s.entry_id = e.id
  UNION ALL
  SELECT e.id, e.entry_date, e.kind, e.category_id, e.amount
  FROM ledger_entries e
  WHERE NOT EXISTS (SELECT 1 FROM ledger_entry_splits s WHERE s.entry_id = e.id);

-- Backstop: at commit, the parts of a split entry add up to its amount. The API checks first and answers with a message.
CREATE OR REPLACE FUNCTION ledger_check_split_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target bigint;
  total bigint;
  parts integer;
  entry_amount bigint;
BEGIN
  IF TG_TABLE_NAME = 'ledger_entries' THEN
    target := NEW.id;
  ELSE
    target := coalesce(NEW.entry_id, OLD.entry_id);
  END IF;
  SELECT count(*), coalesce(sum(amount), 0) INTO parts, total FROM ledger_entry_splits WHERE entry_id = target;
  SELECT amount INTO entry_amount FROM ledger_entries WHERE id = target;
  IF parts > 0 AND entry_amount IS NOT NULL AND total <> entry_amount THEN
    RAISE EXCEPTION 'The parts of entry % add up to % but its amount is %', target, total, entry_amount
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_entry_splits_sum') THEN
    CREATE CONSTRAINT TRIGGER ledger_entry_splits_sum AFTER INSERT OR UPDATE OR DELETE ON ledger_entry_splits
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_split_sum();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_entries_splits_sum') THEN
    CREATE CONSTRAINT TRIGGER ledger_entries_splits_sum AFTER UPDATE OF amount ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_split_sum();
  END IF;
END $$;
