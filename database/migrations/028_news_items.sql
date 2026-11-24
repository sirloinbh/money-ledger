-- #306 Economy news headlines from the Naver News search API, one row per article link (the daily pick, #308,
-- reads them). Headlines and short summaries only, never article bodies. Safe to re-run.

CREATE TABLE IF NOT EXISTS news_items (
  id bigserial PRIMARY KEY,
  link text NOT NULL UNIQUE,
  original_link text,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  publisher text,
  published_at timestamptz NOT NULL,
  query text NOT NULL,
  -- The service date (Asia/Seoul) the article was first stored on.
  fetched_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (title <> '')
);

CREATE INDEX IF NOT EXISTS news_items_fetched_date_idx ON news_items (fetched_date, published_at DESC);
