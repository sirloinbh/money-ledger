#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Signals for healthchecks.io (#284). The firewall only lets allowed IPs in, so nothing outside
# can probe the server; the server sends signals out instead, and a missing signal raises the
# alert, also when the whole server is down.
#   notify.sh ping <check> ok|fail [message]   one signal; the message is the ping body
#   notify.sh health                           check /api/health and ping the health check
# Checks and their server .env keys (the ping URL holds a secret UUID; it is never printed):
#   health  HEALTHCHECK_URL_HEALTH    every 5 minutes, money-health.timer
#   deploy  HEALTHCHECK_URL_DEPLOY    every autodeploy run (2 minutes)
#   backup  HEALTHCHECK_URL_BACKUP    the nightly dump
#   restore HEALTHCHECK_URL_RESTORE   the weekly restore check
#   report  HEALTHCHECK_URL_REPORT    the daily server report
# A check without a URL in .env is skipped. A failed ping never fails the caller.
set -uo pipefail
cd /opt/money-ledger

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | tr -d "\"'\r"; }

ping_check() {
  local check=$1 status=$2 message=${3:-} key url
  case "$check" in
    health | deploy | backup | restore | report) ;;
    *)
      echo "unknown check: $check" >&2
      return 2
      ;;
  esac
  case "$status" in
    ok | fail) ;;
    *)
      echo "status must be ok or fail: $status" >&2
      return 2
      ;;
  esac
  key=HEALTHCHECK_URL_$(printf '%s' "$check" | tr '[:lower:]' '[:upper:]')
  url=$(env_value "$key")
  [ -n "$url" ] || return 0
  if [ "$status" = fail ]; then url=$url/fail; fi
  # The body shows up in the healthchecks.io log (first 10 KB are kept).
  if ! printf '%s' "$message" | head -c 10000 | curl -fsS -m 10 --retry 3 -o /dev/null --data-binary @- "$url"; then
    echo "could not send the $check signal" >&2
  fi
  return 0
}

health() {
  local web_port
  web_port=$(env_value WEB_PORT)
  web_port=${web_port:-8105}
  if curl -fsS -m 10 -o /dev/null "http://127.0.0.1:$web_port/api/health"; then
    ping_check health ok "health ok on port $web_port"
  else
    ping_check health fail "GET http://127.0.0.1:$web_port/api/health failed"
    return 1
  fi
}

case "${1:-}" in
  ping) ping_check "${2:-}" "${3:-}" "${4:-}" ;;
  health) health ;;
  *)
    echo "usage: notify.sh ping <check> ok|fail [message] | health" >&2
    exit 2
    ;;
esac
