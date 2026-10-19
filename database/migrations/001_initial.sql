-- Baseline schema. Feature tables arrive with their issues as 002, 003, ...
-- Every migration must be safe to re-run (IF NOT EXISTS / ON CONFLICT).
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
