#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/deploy/deploy/
# Installs and starts the nightly dump, weekly restore check, 5-minute health and daily report timers
# (#262, #284, #285). Run once as root on the server; adding HEALTHCHECK_URL_* to .env later needs no rerun:
#   sudo bash /opt/money-ledger/deploy/install-backup.sh
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
db=money
# Unit names start with the prefix already installed on the server (an app's DB name, a service's own name).
prefix=money
# Apps also install the health and report timers; the shared services have only the first two.
units="backup restore-check health report"
install -d -o ubuntu -g ubuntu -m 700 "/var/backups/$db"
for unit in $units; do
  install -m 644 "$dir/$unit.service" "/etc/systemd/system/$prefix-$unit.service"
  install -m 644 "$dir/$unit.timer" "/etc/systemd/system/$prefix-$unit.timer"
done
# The first server set up a cron dump for workout-memo (shared-aws-infrastructure user-data).
# The timer replaces it, so the database is not dumped twice a night.
if [ -f "/etc/cron.d/$prefix-backup" ]; then
  rm "/etc/cron.d/$prefix-backup"
  echo "removed /etc/cron.d/$prefix-backup (replaced by $prefix-backup.timer)"
fi
systemctl daemon-reload
timers=()
for unit in $units; do timers+=("$prefix-$unit.timer"); done
systemctl enable --now "${timers[@]}"
systemctl list-timers "${timers[@]}" --no-pager
