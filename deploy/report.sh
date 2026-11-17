#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/app/deploy/
# Daily one-line server report for money-ledger (#285), sent as the body of the healthchecks.io
# "report" signal (deploy/notify.sh). It records what ADR-0009 asked to measure on the shared
# server: memory, disk, this app's container memory and the deployed commit.
#   report.sh          build the line and send it (fail signal over the thresholds)
#   report.sh line     only print the line
# Errors (ADR-0021): lines with "level":"error" in the api logs since the last send (.report-last-sent,
# UTC ISO time; 24 hours when the file is missing), plus the lines remote-deploy.sh saved before it
# replaced the container (.errors-before-deploy.log, emptied after a send). remote-deploy.sh saves with
# the same start time, so a container that ran across a report is not counted twice (#644).
# The line gets errors=<N> and, when N > 0, up to 5 "<requestId> <status> <path>" entries, never a message.
# Thresholds (server .env, optional): REPORT_MEMORY_PERCENT (default 85), REPORT_DISK_PERCENT (default 90),
# REPORT_ERROR_LIMIT (default 0: any error fails the day).
set -euo pipefail
cd /opt/money-ledger
export IMAGE_TAG=${IMAGE_TAG:-$(cat .deployed 2>/dev/null || echo none)}

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | tr -d "\"'\r"; }

memory_percent() { free -m | awk '/^Mem:/ { printf "%d", ($2 - $7) * 100 / $2 }'; }
disk_percent() { df -P / | awk 'NR == 2 { sub("%", "", $5); print $5 }'; }

# "name 123MiB, name 45MiB" for the containers of this compose project.
containers() {
  local ids
  ids=$(docker compose ps -q 2> /dev/null || true)
  if [ -z "$ids" ]; then
    echo "no containers"
    return
  fi
  # Split quotes keep the Go template away from the central template renderer.
  local stats_format='{''{.Name}} {''{.MemUsage}}'
  # shellcheck disable=SC2086
  docker stats --no-stream --format "$stats_format" $ids | awk '{ printf "%s%s %s", (NR > 1 ? ", " : ""), $1, $2 }'
}

# Start of the error window: the time of the last successful send, else 24 hours back.
since=24h
if [ -f .report-last-sent ]; then
  last_sent=$(tr -d '\r\n' < .report-last-sent 2> /dev/null || true)
  case "$last_sent" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) since=$last_sent ;; esac
fi
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)

error_lines() {
  { cat .errors-before-deploy.log 2> /dev/null || true; docker compose logs --no-log-prefix --since "$since" --until "$started" api 2> /dev/null || true; } |
    { grep -F '"level":"error"' || true; }
}
# "<requestId> <status> <path>" for the first 5 request IDs; "-" for a field a line does not have.
# An unexpected 500 writes two error lines with one ID (the handler and the request line): both
# count, but the ID is listed once, with the status and path from the request line.
error_entries() {
  awk '
    function field(re, skip,   v) { if (match($0, re)) { v = substr($0, RSTART + skip, RLENGTH - skip); sub(/"$/, "", v); return v } return "-" }
    { id = field("\"requestId\":\"[A-Za-z0-9_.-]*\"", 13); st = field("\"status\":[0-9]+", 9); p = field("\"path\":\"[^\"]*\"", 8)
      if (id == "-") id = "no-id"
      if (!(id in seen)) { if (n >= 5) next; order[++n] = id; seen[id] = 1; status[id] = st; path[id] = p }
      else if (status[id] == "-") { status[id] = st; path[id] = p } }
    END { for (i = 1; i <= n; i++) printf "%s%s %s %s", (i > 1 ? ", " : ""), order[i], status[order[i]], path[order[i]] }
  ' <<< "$1"
}
error_count() { if [ -z "$1" ]; then echo 0; else printf '%s\n' "$1" | awk 'END { print NR }'; fi; }

line() {
  local failed="" errors_text=" errors=$error_total"
  if [ -f .autodeploy-failed ]; then failed=" autodeploy-failed=$(cat .autodeploy-failed)"; fi
  if [ "$error_total" -gt 0 ]; then errors_text="$errors_text [$(error_entries "$error_source")]"; fi
  printf 'memory=%s%% disk=%s%% deployed=%s%s%s containers: %s\n' "$(memory_percent)" "$(disk_percent)" "$(cat .deployed 2>/dev/null || echo none)" "$failed" "$errors_text" "$(containers)"
}

error_source=$(error_lines)
error_total=$(error_count "$error_source")

case "${1:-}" in
  line) line ;;
  "")
    text=$(line)
    echo "$text"
    memory_limit=$(env_value REPORT_MEMORY_PERCENT)
    disk_limit=$(env_value REPORT_DISK_PERCENT)
    error_limit=$(env_value REPORT_ERROR_LIMIT)
    case "$error_limit" in '' | *[!0-9]*) error_limit=0 ;; esac
    status=ok
    if [ "$(memory_percent)" -gt "${memory_limit:-85}" ] || [ "$(disk_percent)" -gt "${disk_limit:-90}" ]; then status=fail; fi
    if [ "$error_total" -gt "$error_limit" ]; then status=fail; fi
    # The saved lines are counted once; the running container keeps its own logs. The next report
    # starts its window where this one started, so no line is counted twice or skipped.
    if bash deploy/notify.sh ping report "$status" "$text"; then
      if [ -f .errors-before-deploy.log ]; then : > .errors-before-deploy.log || true; fi
      printf '%s\n' "$started" > .report-last-sent || true
    fi
    ;;
  *)
    echo "usage: report.sh [line]" >&2
    exit 2
    ;;
esac
