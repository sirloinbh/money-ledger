-- #293 Trade journal: why a mock order was placed, and a later review note. Safe to re-run.
-- Both are free text the person writes; an empty note is stored as NULL. They never change the fill.
ALTER TABLE mock_orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE mock_orders ADD COLUMN IF NOT EXISTS review_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_orders_note_check') THEN
    ALTER TABLE mock_orders ADD CONSTRAINT mock_orders_note_check
      CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 1000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mock_orders_review_note_check') THEN
    ALTER TABLE mock_orders ADD CONSTRAINT mock_orders_review_note_check
      CHECK (review_note IS NULL OR (char_length(review_note) BETWEEN 1 AND 1000));
  END IF;
END $$;
