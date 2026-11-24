-- #308 The day's Claude pick: the news story it chose, its effect on the economy, the reasoning, and the Korean
-- security it predicts will rise. One pick per service date. order_id links the all-in buy to the pick, so every
-- trade shows the news behind it. Safe to re-run.

CREATE TABLE IF NOT EXISTS daily_picks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pick_date date NOT NULL UNIQUE,
  -- The stored headlines (news_items.id) the story is based on.
  news_item_ids bigint[] NOT NULL CHECK (cardinality(news_item_ids) > 0),
  story_title text NOT NULL CHECK (story_title <> ''),
  story_summary text NOT NULL,
  economic_effect text NOT NULL,
  reasoning text NOT NULL,
  -- No foreign keys to securities and mock_orders on purpose: existing DB tests drop those tables without CASCADE,
  -- and neither table ever deletes rows (a security turns inactive, an order is never removed). The run checks
  -- the security before it stores the pick.
  security_id bigint NOT NULL,
  model text NOT NULL,
  -- The API response as received (never the request headers or the key).
  raw_response jsonb NOT NULL,
  -- Filled once the all-in buy (#307) has been placed.
  order_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS daily_picks_order_idx ON daily_picks (order_id) WHERE order_id IS NOT NULL;
