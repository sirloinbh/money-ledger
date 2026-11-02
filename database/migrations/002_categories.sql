-- Income and expense categories for the ledger (#37). Categories in use are hidden, never deleted.
CREATE TABLE IF NOT EXISTS categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, name)
);

-- Default categories, only into an empty table: re-running must not restore one the user renamed.
-- Expense: food, transport, housing, telecom, living, medical, leisure, other.
-- Income: salary, side income, other.
INSERT INTO categories (kind, name)
SELECT kind, name
FROM (
  VALUES
    (1, 'expense', U&'\C2DD\BE44'),
    (2, 'expense', U&'\AD50\D1B5'),
    (3, 'expense', U&'\C8FC\AC70'),
    (4, 'expense', U&'\D1B5\C2E0'),
    (5, 'expense', U&'\C0DD\D65C'),
    (6, 'expense', U&'\C758\B8CC'),
    (7, 'expense', U&'\C5EC\AC00'),
    (8, 'expense', U&'\AE30\D0C0'),
    (9, 'income', U&'\AE09\C5EC'),
    (10, 'income', U&'\BD80\C218\C785'),
    (11, 'income', U&'\AE30\D0C0')
) AS seed (seed_order, kind, name)
WHERE NOT EXISTS (SELECT 1 FROM categories)
ORDER BY seed_order;
