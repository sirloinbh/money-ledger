-- #37 Income and expense categories for the ledger. Safe to re-run.
-- A category in use is hidden, never deleted, so past entries keep their category.
CREATE TABLE IF NOT EXISTS ledger_categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 30),
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Hidden categories keep their name, so showing one again never collides.
  CONSTRAINT ledger_categories_kind_name_key UNIQUE (kind, name)
);

-- Default categories, only into an empty table: a re-run must not bring back a renamed default.
INSERT INTO ledger_categories (kind, name)
SELECT kind, name
FROM (
  VALUES
  ('expense', U&'\C2DD\BE44'), -- Food
  ('expense', U&'\AD50\D1B5'), -- Transport
  ('expense', U&'\C8FC\AC70'), -- Housing
  ('expense', U&'\D1B5\C2E0'), -- Telecom
  ('expense', U&'\C0DD\D65C'), -- Living
  ('expense', U&'\C758\B8CC'), -- Medical
  ('expense', U&'\C5EC\AC00'), -- Leisure
  ('expense', U&'\AE30\D0C0'), -- Other
  ('income', U&'\AE09\C5EC'), -- Salary
  ('income', U&'\BD80\C218\C785'), -- Side income
  ('income', U&'\AE30\D0C0') -- Other
) AS defaults (kind, name)
WHERE NOT EXISTS (SELECT 1 FROM ledger_categories);
