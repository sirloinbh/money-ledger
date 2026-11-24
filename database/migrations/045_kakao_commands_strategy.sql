-- #312 The chatbot records two more commands: choosing a strategy (단타 / 장투) and answering the morning
-- question (유지 / 매도). Safe to re-run.

ALTER TABLE kakao_commands DROP CONSTRAINT IF EXISTS kakao_commands_command_check;
ALTER TABLE kakao_commands ADD CONSTRAINT kakao_commands_command_check
  CHECK (command IN ('status', 'positions', 'news', 'returns', 'strategy', 'answer', 'unknown'));
