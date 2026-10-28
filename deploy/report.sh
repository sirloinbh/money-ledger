#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Daily one-line server report for money-ledger (#285), sent as the body of the healthchecks.io
# "report" signal (deploy/notify.sh). It records what ADR-0009 asked to measure on the shared
# server: memory, disk, this app's container memory and the deployed commit.
#   report.sh          build the line and send it (fail signal over the thresholds)
#   report.sh line     only print the line
# Thresholds (server .env, optional): REPORT_MEMORY_PERCENT (default 85), REPORT_DISK_PERCENT (default 90).
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

line() {
  local failed=""
  if [ -f .autodeploy-failed ]; then failed=" autodeploy-failed=$(cat .autodeploy-failed)"; fi
  printf 'memory=%s%% disk=%s%% deployed=%s%s containers: %s\n' "$(memory_percent)" "$(disk_percent)" "$(cat .deployed 2>/dev/null || echo none)" "$failed" "$(containers)"
}

case "${1:-}" in
  line) line ;;
  "")
    text=$(line)
    echo "$text"
    memory_limit=$(env_value REPORT_MEMORY_PERCENT)
    disk_limit=$(env_value REPORT_DISK_PERCENT)
    status=ok
    if [ "$(memory_percent)" -gt "${memory_limit:-85}" ] || [ "$(disk_percent)" -gt "${disk_limit:-90}" ]; then status=fail; fi
    bash deploy/notify.sh ping report "$status" "$text" || true
    ;;
  *)
    echo "usage: report.sh [line]" >&2
    exit 2
    ;;
esac
