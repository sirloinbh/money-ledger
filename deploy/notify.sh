#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/deploy/deploy/
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
# Sink (#1091): NOTIFY_SINK in .env or the shared server file /opt/project-standards/.env chooses where a signal goes:
#   healthchecks (default)  the ping above; nothing changes until NOTIFY_SINK is set
#   aws                     the state goes to the server-wide emitter (/opt/project-standards/proxy/signals.sh record), which sends
#                           the CloudWatch metrics and the SNS message (docs/server-proxy.md, "AWS alert path")
#   both                    both; one failing sink never stops the other
# A check without a URL in .env is skipped. A failed ping makes `ping` exit 1, so report.sh keeps its
# saved error lines for the next report (#1030); the other callers add `|| true`.
set -uo pipefail
cd /opt/money-ledger

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | tr -d "\"'\r"; }
shared_env=${STANDARDS_ENV_FILE:-/opt/project-standards/.env}
signals_sh=${SIGNALS_SH:-/opt/project-standards/proxy/signals.sh}
# NOTIFY_SINK: the app .env first, then the shared server file.
sink_value() {
  local v
  v=$(env_value NOTIFY_SINK)
  if [ -z "$v" ] && [ -r "$shared_env" ]; then v=$(sed -n "s/^NOTIFY_SINK=//p" "$shared_env" 2>/dev/null | tail -n 1 | tr -d "\"'\r"); fi
  printf '%s' "$v"
}

# Sink healthchecks: the ping. A check without a URL is skipped.
send_healthchecks() {
  local check=$1 status=$2 message=$3 key url
  key=HEALTHCHECK_URL_$(printf '%s' "$check" | tr '[:lower:]' '[:upper:]')
  url=$(env_value "$key")
  [ -n "$url" ] || return 0
  if [ "$status" = fail ]; then url=$url/fail; fi
  # The body shows up in the healthchecks.io log (first 10 KB are kept).
  if ! printf '%s' "$message" | head -c 10000 | curl -fsS -m 10 --retry 3 -o /dev/null --data-binary @- "$url"; then
    echo "could not send the $check signal" >&2
    return 1
  fi
  return 0
}

# Sink aws: only the state is written here; signals.sh evaluate judges all signals and talks to AWS. The message is not sent anywhere.
send_aws() {
  local check=$1 status=$2
  if ! bash "$signals_sh" record "money-ledger" "$check" "$status"; then
    echo "could not record the $check signal for the aws sink" >&2
    return 1
  fi
  return 0
}

# One signal to the sink chosen by NOTIFY_SINK. Returns 1 when any chosen sink failed.
ping_check() {
  local check=$1 status=$2 message=${3:-} sink rc=0
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
  sink=$(sink_value)
  case "${sink:-healthchecks}" in
    healthchecks) send_healthchecks "$check" "$status" "$message" || rc=1 ;;
    aws) send_aws "$check" "$status" || rc=1 ;;
    both)
      send_healthchecks "$check" "$status" "$message" || rc=1
      send_aws "$check" "$status" || rc=1
      ;;
    *)
      echo "unknown NOTIFY_SINK: $sink; using healthchecks" >&2
      send_healthchecks "$check" "$status" "$message" || rc=1
      ;;
  esac
  return "$rc"
}

health() {
  local web_port
  web_port=$(env_value WEB_PORT)
  web_port=${web_port:-8105}
  if curl -fsS -m 10 -o /dev/null "http://127.0.0.1:$web_port/api/health"; then
    ping_check health ok "health ok on port $web_port" || true
  else
    ping_check health fail "GET http://127.0.0.1:$web_port/api/health failed" || true
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
