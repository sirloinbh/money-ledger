#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/app/deploy/
# Pull-based continuous deployment, run every 2 minutes by money-autodeploy.timer.
# Deploys origin/main only after every workflow run of the repository for that commit passed.
# The firewall stays closed to GitHub: the server polls the public repository and API.
#   autodeploy.sh            check and deploy if needed
#   autodeploy.sh ci-state   print pass|fail|pending for workflow-runs JSON on stdin (tests)
set -euo pipefail
repo=sirloinbh/money-ledger
app=/opt/money-ledger

# pass: every workflow run completed with success/skipped/neutral; fail: any other result;
# pending: none reported yet or still running.
# Runs GitHub starts on its own (event "dynamic": Dependabot updates, CodeQL default setup)
# do not count: a Dependabot update failing for lack of a fixed version, or CodeQL failing to
# download its CLI, says nothing about the commit, and those runs cannot be re-run (#417).
ci_state() {
  python3 -c '
import json, sys
runs = [r for r in json.load(sys.stdin).get("workflow_runs", []) if r.get("event") != "dynamic"]
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
# healthchecks.io signal on every run that decides something (#284). A run that only finds the
# lock busy sends nothing; the check's grace time covers it.
signal() { if [ -f deploy/notify.sh ]; then bash deploy/notify.sh ping deploy "$@" || true; fi; }
# One lock for every app on the server (ADR-0009): builds share 2 GB of memory, so only
# one app builds or deploys at a time. A busy lock means "try again on the next run".
exec 9> /run/lock/apps-deploy.lock
flock -n 9 || exit 0

git fetch --quiet origin main
full=$(git rev-parse origin/main)
sha=${full:0:12}
if [ "$sha" = "$(cat .deployed 2>/dev/null || true)" ]; then
  signal ok "up to date at $sha"
  exit 0
fi
if [ "$sha" = "$(cat .autodeploy-failed 2>/dev/null || true)" ]; then
  signal fail "$sha failed before; waiting for a new commit on main"
  exit 0
fi

state=$(curl -fsS -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$repo/actions/runs?head_sha=$full&per_page=100" | ci_state)
case "$state" in
  pending)
    echo "waiting for CI of $sha"
    signal ok "waiting for CI of $sha"
    exit 0
    ;;
  fail)
    echo "CI failed for $sha; not deploying"
    echo "$sha" > .autodeploy-failed
    signal fail "CI failed for $sha"
    exit 0
    ;;
esac

# Run the deploy script of the new commit (git replaces files, the running bash keeps
# the old inode, so checking out under a running script is safe).
git checkout --quiet --detach "$full"
if APPS_DEPLOY_LOCKED=1 bash deploy/remote-deploy.sh deploy "$full"; then
  rm -f .autodeploy-failed
  signal ok "deployed $sha"
else
  echo "$sha" > .autodeploy-failed
  signal fail "deploy of $sha failed"
  exit 1
fi
