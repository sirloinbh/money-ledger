#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Installs and starts the nightly dump, weekly restore check, 5-minute health and daily report timers
# (#262, #284, #285). Run once as root on the server; adding HEALTHCHECK_URL_* to .env later needs no rerun:
#   sudo bash /opt/money-ledger/deploy/install-backup.sh
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
db=money
install -d -o ubuntu -g ubuntu -m 700 "/var/backups/$db"
for unit in backup restore-check health report; do
  install -m 644 "$dir/$unit.service" "/etc/systemd/system/$db-$unit.service"
  install -m 644 "$dir/$unit.timer" "/etc/systemd/system/$db-$unit.timer"
done
# The first server set up a cron dump for workout-memo (shared-aws-infrastructure user-data).
# The timer replaces it, so the database is not dumped twice a night.
if [ -f "/etc/cron.d/$db-backup" ]; then
  rm "/etc/cron.d/$db-backup"
  echo "removed /etc/cron.d/$db-backup (replaced by $db-backup.timer)"
fi
systemctl daemon-reload
systemctl enable --now "$db-backup.timer" "$db-restore-check.timer" "$db-health.timer" "$db-report.timer"
systemctl list-timers "$db-backup.timer" "$db-restore-check.timer" "$db-health.timer" "$db-report.timer" --no-pager
