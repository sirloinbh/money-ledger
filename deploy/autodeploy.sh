#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Pull-based continuous deployment, run every 2 minutes by money-autodeploy.timer.
# Deploys origin/main only after every GitHub Actions check run of that commit passed.
# The firewall stays closed to GitHub: the server polls the public repository and API.
#   autodeploy.sh            check and deploy if needed
#   autodeploy.sh ci-state   print pass|fail|pending for check-runs JSON on stdin (tests)
set -euo pipefail
repo=sirloinbh/money-ledger
app=/opt/money-ledger

# pass: every check run completed with success/skipped/neutral; fail: any other result;
# pending: none reported yet or still running.
ci_state() {
  python3 -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
if not runs or any(r["status"] != "completed" for r in runs):
    print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs):
    print("pass")
else:
    print("fail")
'
}
if [ "${1:-}" = ci-state ]; then
  ci_state
  exit 0
fi

cd "$app"
# One lock for every app on the server (ADR-0009): builds share 2 GB of memory, so only
# one app builds or deploys at a time. A busy lock means "try again on the next run".
exec 9> /run/lock/apps-deploy.lock
flock -n 9 || exit 0

git fetch --quiet origin main
full=$(git rev-parse origin/main)
sha=${full:0:12}
if [ "$sha" = "$(cat .deployed 2>/dev/null || true)" ]; then exit 0; fi
if [ "$sha" = "$(cat .autodeploy-failed 2>/dev/null || true)" ]; then exit 0; fi

state=$(curl -fsS -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$repo/commits/$full/check-runs?per_page=100" | ci_state)
case "$state" in
  pending)
    echo "waiting for CI of $sha"
    exit 0
    ;;
  fail)
    echo "CI failed for $sha; not deploying"
    echo "$sha" > .autodeploy-failed
    exit 0
    ;;
esac

# Run the deploy script of the new commit (git replaces files, the running bash keeps
# the old inode, so checking out under a running script is safe).
git checkout --quiet --detach "$full"
if APPS_DEPLOY_LOCKED=1 bash deploy/remote-deploy.sh deploy "$full"; then
  rm -f .autodeploy-failed
else
  echo "$sha" > .autodeploy-failed
  exit 1
fi
