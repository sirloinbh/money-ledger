# Claude picks the biggest news story and the stock, and the app buys it all-in (#308)

## Purpose

Steps 2 and 3 of mock investing v2 (epic #303): Claude reads the day's stored headlines (#306), picks the biggest story, explains its effect on the economy, predicts one Korean stock that will rise, and the app buys that stock all-in (#307) without asking.

## Changes

- `database/migrations/032_daily_picks.sql`: `daily_picks` (one row per service date: the news item ids, story, effect, reasoning, `security_id`, model, raw response, `order_id` to `mock_orders`).
- `backend/src/picks/claude.ts`: Claude Messages API client with `fetch` (no new package). The key goes in the `x-api-key` header only. Structured output (`output_config.format` JSON schema), `effort: high`, and `fallbacks: "default"` so a safety decline is re-run on the fallback model. `fakeClaude` for tests and `PICK_SOURCE=fake`.
- `backend/src/picks/prompt.ts`: system prompt, the headline list (marked as data), the answer schema and the Zod check.
- `backend/src/picks/run.ts`: the run. The answer must cite headlines that exist and name an active Korean security (`currency = 'KRW'`, `active`); otherwise Claude is asked once more with the reason (never more than twice). One pick per day: a second run does nothing, and a pick whose buy failed is only bought again, never re-picked. A run is skipped while a v2 position is open.
- `backend/src/picks/jobs.ts`: pg-boss queue `daily-pick`, `0 8 * * 1-5` (08:00 Asia/Seoul, weekdays, 30 minutes after the news fetch). "No news yet", "no valid pick" and a failed buy throw so pg-boss retries.
- `GET /api/picks?date=` (default today) returns the pick with its security and the headlines behind it. `POST /api/picks/run` runs it by hand (503 without a client).
- Frontend: `daily-pick.tsx` card on the Mock trading page (story, effect, reasoning, stock, news links, bought or not).
- `.env.example`, `compose.yaml`: `ANTHROPIC_API_KEY`, `PICK_MODEL`, `PICK_SOURCE` (names only).

## Choices

- Model: `claude-opus-5-5` (the `claude-api` skill's default), changeable with `PICK_MODEL`. It runs once a day, so cost is small; set a monthly spend limit on the key (#304).
- Weekdays only, because the project has no holiday calendar.

## Verification

See the PR.
