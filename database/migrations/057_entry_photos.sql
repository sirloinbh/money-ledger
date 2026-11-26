-- #300 Receipt photos attached to an entry. Safe to re-run.
-- The image bytes live in the private object store (S3), not in the database: this table keeps the key and the
-- facts the app needs to list and serve a photo. Deleting an entry deletes its rows here (the app deletes the stored
-- objects too).
CREATE TABLE IF NOT EXISTS ledger_entry_photos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES ledger_entries (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE CHECK (char_length(storage_key) BETWEEN 1 AND 200),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_entry_photos_entry_idx ON ledger_entry_photos (entry_id, id);
