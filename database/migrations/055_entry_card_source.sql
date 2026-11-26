-- #57 Entries imported from a card usage file remember where they came from. Safe to re-run.
-- Only the last 4 digits of the card and the approval number are kept: never the file or the full card number.
-- (source, source_card, source_ref) is unique, so importing the same file again finds the entry and updates it.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS source text CHECK (source IN ('woori-card'));
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS source_card text CHECK (source_card ~ '^[0-9]{4}$');
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS source_ref text CHECK (char_length(source_ref) BETWEEN 1 AND 40);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_source_all_or_none') THEN
    ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_source_all_or_none
      CHECK ((source IS NULL) = (source_card IS NULL) AND (source IS NULL) = (source_ref IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_source_key
  ON ledger_entries (source, source_card, source_ref) WHERE source IS NOT NULL;
