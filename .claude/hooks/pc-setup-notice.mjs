// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/common/.claude/hooks/에서
// Claude Code SessionStart hook (#368, docs/agent-guardrails.md): this PC's global instructions
// live outside every repository, so `git pull` cannot update them. While they still hold the old
// Fork branch rule, tell the user how to apply the current rule. It prints nothing once applied.
// Node built-ins only. It only reads, and any error ends quietly so a session is never blocked.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const FILES = [path.join('.claude', 'CLAUDE.md'), path.join('.codex', 'AGENTS.md')];
const STEPS = 'project-standards 폴더에서 git switch main, git pull --ff-only, powershell -NoProfile -ExecutionPolicy Bypass -File tools\\install.ps1, node tools\\check-git-permissions.mjs 순서로 실행합니다(docs/user-steps.md 16장, #361).';

function hasForkRule(file) {
  try {
    return /^## .*Fork/m.test(readFileSync(path.join(homedir(), file), 'utf8'));
  } catch {
    return false;
  }
}

try {
  const stale = FILES.filter(hasForkRule).map((file) => `~/${file.replaceAll('\\', '/')}`);
  if (stale.length > 0) {
    const notice = `이 PC에 아직 git CLI 브랜치 규칙이 적용되지 않았습니다(${stale.join(', ')}에 Fork 규칙이 남아 있음). ${STEPS}`;
    const additionalContext = `${notice} 다른 작업을 시작하기 전에 사용자에게 이 내용을 알리고, 전역 지침의 Fork 규칙보다 이 리포의 std-git-writing 스킬을 따릅니다.`;
    console.log(JSON.stringify({ systemMessage: notice, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
  }
} catch {
  // Never block a session over a reminder.
}
