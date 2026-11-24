# Collect daily economy news headlines from the Naver News API (#306)

## Purpose

Step 1 of mock investing v2 (epic #303): the daily pick (#308) reads the day's headlines, and nothing stored news before.

## Changes

- `database/migrations/028_news_items.sql`: `news_items` (title, summary, link, original link, publisher, published time, query, fetched date in KST). `link` is unique, so an article found by several queries is stored once and keeps the first query.
- `backend/src/news/`: `source.ts` (Naver source with `fetch`, response parser, tag stripping, fake source, `newsSourceFromEnv`), `store.ts` (fetch, save, list), `jobs.ts` (pg-boss queue `daily-news`), `router.ts`.
- Queries: 경제, 증시, 금리, 환율, 반도체, newest first, 30 items each. Headlines and short summaries only.
- Schedule: `30 7 * * 1-5` (07:30 Asia/Seoul on weekdays). The project has no holiday calendar, so a weekday holiday only stores whatever new links Naver returns. A run where any query failed throws, so pg-boss retries it.
- `GET /api/news?date=YYYY-MM-DD` lists the stored items (default today). `POST /api/news/fetch` runs the fetch by hand (503 without a source).
- `.env.example` and `compose.yaml`: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` (names only), `NEWS_SOURCE=fake` for running without keys (refused in production).
- `docs/openapi.json` regenerated.

## Verification

- Unit tests (`backend/test/news.test.ts`): a recorded-shape response, tag stripping, entity decoding, bad response shape, headers and no key in errors, env selection, the schedule.
- DB integration tests (`backend/test/news.integration.test.ts`) on a dedicated test DB: deduplication, partial failure, both routes, 503 without a source.
- Real-key check: waiting on #304 (API keys). Not run.
