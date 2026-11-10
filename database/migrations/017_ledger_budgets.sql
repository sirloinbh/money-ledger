-- #42 Monthly budgets for expense categories. Safe to re-run.
-- Decisions (2026-11-10, issue #42): a month without its own row uses the latest earlier row of that category
-- (worked out when read; nothing is copied). Saving a month changes that month and the months after it that
-- have no row of their own. An amount of 0 means "no budget" from that month on.
CREATE TABLE IF NOT EXISTS ledger_budgets (
  category_id bigint NOT NULL,
  -- Only expense categories have a budget: the (category_id, kind) key below makes that hold.
  kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
  -- The first day of the month.
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  amount bigint NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, month),
  CONSTRAINT ledger_budgets_category_fkey FOREIGN KEY (category_id, kind)
    REFERENCES ledger_categories (id, kind) ON DELETE CASCADE
);
