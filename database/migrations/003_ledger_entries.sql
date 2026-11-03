-- #38 Income and expense entries. Safe to re-run.
-- Amounts are whole won (bigint, >= 0); the direction is `kind`, never the sign.

-- Lets an entry's (category_id, kind) reference its category, so the kinds always match.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_categories_id_kind_key ON ledger_categories (id, kind);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  amount bigint NOT NULL CHECK (amount >= 0),
  category_id bigint NOT NULL,
  memo text NOT NULL DEFAULT '' CHECK (char_length(memo) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_category_fkey FOREIGN KEY (category_id, kind)
    REFERENCES ledger_categories (id, kind)
);

CREATE INDEX IF NOT EXISTS ledger_entries_entry_date_idx ON ledger_entries (entry_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS ledger_entries_category_idx ON ledger_entries (category_id, kind);
