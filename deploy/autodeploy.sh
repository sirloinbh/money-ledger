#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/deploy/deploy/
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
# The journal line for each run. The timer fires every 2 minutes, so a line is written when the decision changes and at
# most once an hour while it stays the same: "waiting for CI", "up to date" and "busy" are then visible without filling
# the journal (#808). .autodeploy-log holds "<epoch seconds> <last line>".
say() {
  local now last_at last_msg
  now=$(date +%s)
  last_at=$(cut -d' ' -f1 .autodeploy-log 2> /dev/null || true)
  last_msg=$(cut -d' ' -f2- .autodeploy-log 2> /dev/null || true)
  case "$last_at" in '' | *[!0-9]*) last_at=0 ;; esac
  if [ "$last_msg" != "$1" ] || [ $((now - last_at)) -ge 3600 ]; then
    echo "$1"
    echo "$now $1" > .autodeploy-log
  fi
}
# healthchecks.io signal on every run that decides something (#284). A run that only finds the
# lock busy sends nothing; the check's grace time covers it.
signal() { if [ -f deploy/notify.sh ]; then bash deploy/notify.sh ping deploy "$@" || true; fi; }
# One lock for every app on the server (ADR-0009): builds share 2 GB of memory, so only
# one app builds or deploys at a time. A busy lock is waited for up to 100 seconds, inside the 2-minute
# timer period, so a run does not give up while a build ahead of it is about to finish (#899): with several
# apps merged at once, a deploy that only polled once per run lost the lock again and again and waited far
# longer than the queue ahead of it. If the lock is still busy, the next run tries again. AUTODEPLOY_LOCK_WAIT
# (seconds) shortens the wait for tests.
# The holder file names the app that took the lock last, so the busy line says who is deploying; it is
# removed when that run ends, and a manual deploy (remote-deploy.sh) does not write it.
lock=/run/lock/apps-deploy.lock
holder=/run/lock/apps-deploy.holder
exec 9> "$lock"
if ! flock -w "${AUTODEPLOY_LOCK_WAIT:-100}" 9; then
  say "another deploy holds the lock ($(cat "$holder" 2> /dev/null || echo unknown)); trying again on the next run"
  exit 0
fi
echo "money-ledger" > "$holder" 2> /dev/null || true
trap 'rm -f "$holder"' EXIT

# FETCH_HEAD is the tip that was just fetched, whether or not the origin/main tracking ref was updated.
git fetch --quiet origin main
full=$(git rev-parse FETCH_HEAD)
sha=${full:0:12}
if [ "$sha" = "$(cat .deployed 2>/dev/null || true)" ]; then
  say "up to date at $sha"
  signal ok "up to date at $sha"
  exit 0
fi
if [ "$sha" = "$(cat .autodeploy-failed 2>/dev/null || true)" ]; then
  say "$sha failed before; waiting for a new commit on main"
  signal fail "$sha failed before; waiting for a new commit on main"
  exit 0
fi

# A failed call (rate limit of the unauthenticated API, network) must not end the run silently: say so, signal, and try again
# on the next run (#871). The state is empty when curl failed, because ci_state then reads nothing.
if ! state=$(curl -fsS -m 30 -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$repo/actions/runs?head_sha=$full&per_page=100" | ci_state 2> /dev/null) || [ -z "$state" ]; then
  say "could not read the CI state of $sha from GitHub; trying again on the next run"
  signal fail "could not read the CI state of $sha from GitHub"
  exit 0
fi
case "$state" in
  pending)
    say "waiting for CI of $sha (deployed: $(cat .deployed 2> /dev/null || echo none))"
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
#
# The output of the deploy is kept in .last-deploy.log (overwritten by each run), and a failed deploy sends its last lines
# with the fail signal, so the reason is visible without a shell (#872). Values that look like a token, secret, password or
# key are masked first; the deploy scripts do not print them, this is a second guard.
if APPS_DEPLOY_LOCKED=1 bash deploy/remote-deploy.sh deploy "$full" 2>&1 | tee .last-deploy.log; then
  rm -f .autodeploy-failed
  signal ok "deployed $sha"
else
  echo "$sha" > .autodeploy-failed
  reason=$(tail -n 20 .last-deploy.log 2> /dev/null | sed -E 's/((TOKEN|SECRET|PASSWORD|KEY)[A-Za-z0-9_]*=)[^[:space:]]+/\1***/g' || true)
  signal fail "deploy of $sha failed. Last lines of the deploy output:
$reason"
  exit 1
fi
