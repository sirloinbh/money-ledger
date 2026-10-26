#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Installs and starts the pull-based deployment timer. Run as root on the server:
#   sudo bash /opt/money-ledger/deploy/install-autodeploy.sh
set -euo pipefail
dir=$(cd "$(dirname "$0")" && pwd)
unit=money-autodeploy
install -m 644 "$dir/autodeploy.service" "/etc/systemd/system/$unit.service"
install -m 644 "$dir/autodeploy.timer" "/etc/systemd/system/$unit.timer"
systemctl daemon-reload
systemctl enable --now "$unit.timer"
systemctl list-timers "$unit.timer" --no-pager
