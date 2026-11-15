-- #60 Merchant names, uncategorized entries and keyword rules. Safe to re-run.
-- Decisions (2026-11-05): keyword rules only (no external AI), rules match the merchant only, and both income
-- and expense entries may stay uncategorized.

-- The merchant as typed or imported (#57-#59). Empty when unknown; rules never match an empty merchant.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS merchant text NOT NULL DEFAULT ''
  CHECK (merchant = btrim(merchant) AND char_length(merchant) <= 50);

-- NULL means uncategorized (the screen label is "미분류"). The (category_id, kind) foreign key is not checked while category_id is NULL.
ALTER TABLE ledger_entries ALTER COLUMN category_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ledger_entries_uncategorized_idx ON ledger_entries (entry_date DESC, id DESC)
  WHERE category_id IS NULL;

-- A merchant containing `keyword` (case-insensitive) gets `category_id`. The longest matching keyword wins.
-- `kind` is the category's kind, so a rule only ever applies to entries of that kind.
CREATE TABLE IF NOT EXISTS ledger_category_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  keyword text NOT NULL CHECK (keyword = btrim(keyword) AND char_length(keyword) BETWEEN 1 AND 50),
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  category_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_category_rules_category_fkey FOREIGN KEY (category_id, kind)
    REFERENCES ledger_categories (id, kind)
);

-- One rule per keyword and kind, ignoring letter case.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_category_rules_keyword_key
  ON ledger_category_rules (kind, lower(keyword));
