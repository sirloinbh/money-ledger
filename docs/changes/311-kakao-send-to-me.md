# Send reports to my KakaoTalk with the send-to-me API (#311)

Part of epic #303 (mock investing v2). Issue: <https://github.com/sirloinbh/money-ledger/issues/311>.

## Purpose

The app needs to message me by itself (a day trade sale, the morning question), which a chatbot cannot do. This adds Kakao Login once from Settings, a stored (encrypted) token that is refreshed before it expires, a sender, message builders and a Settings card.

## Changes

| Area     | Change                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database | `029_kakao_connection.sql`: `kakao_connection` (one row: status, both tokens encrypted, expiry times) and `kakao_login_states` (one-time login state, 10 minutes)                                                                                                                          |
| Backend  | `backend/src/kakao/`: `crypto.ts` (AES-256-GCM, key `KAKAO_TOKEN_KEY`), `api.ts` (token exchange, refresh, memo send with `fetch`), `service.ts` (login, refresh before expiry under a row lock, one retry after a refused token, `revoked` status), `messages.ts`, `fake.ts`, `router.ts` |
| API      | `GET /api/kakao/status`, `POST /api/kakao/connect`, `GET /api/kakao/callback`, `POST /api/kakao/test`, `DELETE /api/kakao/connection`; `docs/openapi.json` regenerated                                                                                                                     |
| Frontend | `kakao-settings.tsx` card on the Settings page: Connect / Reconnect, Send test message, Disconnect (with confirmation)                                                                                                                                                                     |
| Settings | `.env.example`: `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `KAKAO_TOKEN_KEY` (names only)                                                                                                                                                                          |

Notes for #312 and #313:

- Send through the `Messenger` type (`service.send(template)`); tests use `fakeMessenger()` (records `sent`, `failures` makes the next send throw).
- Builders take server values only (whole-won integers, percent strings already rounded in SQL) and just format them, so no float math touches an amount. Text is cut to Kakao's 200 characters.
- The migration number is 029 (lane-3 range after the coordinator's correction).

## Verification

- `npm run check` (with `TEST_DATABASE_URL` on a dedicated Postgres 17 container, all migrations applied): passed, no skipped DB tests. `backend/test/openapi.test.ts` now registers the Kakao routes (stub service) and lists the `/api/kakao` mount.
- Backend: `backend/test/kakao.test.ts` (encryption, login URL, formatting, each builder, truncation) and `backend/test/kakao.integration.test.ts` on a dedicated Postgres 17 test DB, not skipped: encrypted storage, one-use and expired login state, refresh before expiry (old refresh token kept or replaced), two sends at once refresh once, revoked refresh token shows `revoked` and stops sending, memo refused then refresh and retry, other failures keep the connection, every route, not-configured answers.
- Frontend: `frontend/src/kakao-settings.test.tsx` (each state, Connect, test message, Reconnect, error, confirmed Disconnect, return from the login) and `app.test.tsx` (the new status request).
- Real browser (Playwright, API with fake Kakao keys and a seeded connection row): Settings at 1440x900 shows "Not connected." with a 36 px Connect button; at 390x844 shows "Connected. Since ..." with Send test message and Disconnect side by side; no horizontal scroll at either size.

## Review round 1 (self-review by a separate read-only agent, no blocking findings)

Fixed in a follow-up commit: a 10 s timeout on every Kakao call (a hung call no longer holds the row lock); optional `KAKAO_APP_URL` for the web app when it is not on the redirect URI's origin; every login-callback failure now ends on `/settings?kakao=failed`; tokens that the current `KAKAO_TOKEN_KEY` cannot read answer 409 "Reconnect KakaoTalk"; message truncation cuts by code points.

Documented, not changed: the 60-day refresh expiry is not checked ahead of time (a failed send marks the connection `revoked`; #313 should surface a failed send); Kakao invalidates the old refresh token when it rotates it, so a crash between Kakao's answer and the commit loses the new one and needs a reconnect; Disconnect deletes the local tokens only and does not unlink on Kakao's side; the login state is not tied to the browser (the shared sign-in already guards `/connect`).

CI's `npm run knip` flagged an unused exported type (`KakaoStatus`); it is no longer exported, and `npm run knip` shows no Kakao item. (`npm run check` does not include knip.)

## Limits and follow-up

- Real-key check is waiting on #304 (Kakao REST API key, client secret, redirect URI registered in Kakao Developers). Until then the Kakao calls are only exercised against a fake `fetch`; the live token and memo endpoints are not verified.
- The Kakao token and memo request shapes follow Kakao's public documentation; confirm them with the real keys.
- The post-login redirect and message links assume the web app shares the redirect URI's origin (production, behind the proxy); set `KAKAO_APP_URL` otherwise.
- Only text templates are built; `Template` also accepts `list` for later.
