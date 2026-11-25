-- #291 Merchants the user dismissed from the "recurring payments" suggestions, so they do not come back. Safe to re-run.
-- Keyed by the normalized merchant (merchantKey in backend/src/ledger/suggestions.ts), so "스타벅스 강남점" and
-- "스타벅스 역삼점" are one merchant. Nothing else depends on it: deleting a row only lets the suggestion return.
CREATE TABLE IF NOT EXISTS ledger_recurring_dismissals (
  merchant_key text PRIMARY KEY CHECK (char_length(merchant_key) BETWEEN 1 AND 100),
  dismissed_at timestamptz NOT NULL DEFAULT now()
);
