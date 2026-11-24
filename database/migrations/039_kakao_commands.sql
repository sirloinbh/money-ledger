-- #312 One row per KakaoTalk chatbot command: when, which command, how it ended. The Kakao user ID and the
-- text the user typed are never stored, so a leaked table says nothing about who asked or what they wrote.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS kakao_commands (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  command text NOT NULL CHECK (command IN ('status', 'positions', 'news', 'returns', 'unknown')),
  result text NOT NULL CHECK (result IN ('ok', 'unavailable', 'error', 'timeout'))
);

CREATE INDEX IF NOT EXISTS kakao_commands_received_at_idx ON kakao_commands (received_at DESC);
