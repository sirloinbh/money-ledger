-- #193 "The source does not know this scope" (a Tiingo 404) as a flag, not as message text. The fetch used to
-- compare last_error with its own message, which stopped matching when the messages were translated (#120).
-- Safe to re-run.

ALTER TABLE price_fetch_state ADD COLUMN IF NOT EXISTS not_found boolean NOT NULL DEFAULT false;

-- Rows saved before this migration, under either text the fetch has written: the Korean note from before the
-- translation (escaped below) and 'Not found at Tiingo' after it.
UPDATE price_fetch_state SET not_found = true
WHERE source = 'TIINGO' AND NOT not_found
  AND last_error IN ('Not found at Tiingo', U&'Tiingo\C5D0 \C5C6\B294 \C885\BAA9\C785\B2C8\B2E4');
