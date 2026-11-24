-- #311 KakaoTalk "send to me": one connection for the one user, and the one-time state of a login in progress.
-- Tokens are stored encrypted (AES-256-GCM, backend/src/kakao/crypto.ts); never plain text. Safe to re-run.

CREATE TABLE IF NOT EXISTS kakao_connection (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  status text NOT NULL CHECK (status IN ('connected', 'revoked')),
  access_token_enc text NOT NULL,
  access_expires_at timestamptz NOT NULL,
  refresh_token_enc text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kakao_login_states (
  state text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
