#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Runs on the Lightsail server from /opt/money-ledger, started by scripts/deploy.ps1 or
# by autodeploy.sh.
#   deploy <ref>  build the commit, back up, migrate, start, health check; on failure
#                 start the previous images again
#   rollback      start the previously deployed images again
# Images are tagged by commit, so a rollback does not rebuild. Migrations are
# forward-only; restoring data from the pre-deploy dump is a separate, manual step.
# compose.yaml must tag images money-backend:${IMAGE_TAG} and
# money-frontend:${IMAGE_TAG} and publish the web port as ${WEB_BIND}:${WEB_PORT}.
set -euo pipefail
cd /opt/money-ledger
# One deploy at a time across every app on the server (ADR-0009). The autodeploy timer
# already holds the lock and sets the flag.
if [ -z "${APPS_DEPLOY_LOCKED:-}" ]; then
  exec 9> /run/lock/apps-deploy.lock
  flock -w 1800 9 || { echo "another deploy is running" >&2; exit 4; }
fi

# The server .env decides the published web port; without it the registry port is used.
web_port=$(sed -n 's/^WEB_PORT=//p' .env 2>/dev/null | tail -n 1)
web_port=${web_port:-8105}
# compose reads the build secret npm_token (secrets.npm_token.environment) from the shell
# environment only, never from .env, so the server .env token is exported for the build.
# The value is never printed.
if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  NODE_AUTH_TOKEN=$(sed -n 's/^NODE_AUTH_TOKEN=//p' .env 2>/dev/null | tail -n 1 | tr -d "\"'\r")
fi
export NODE_AUTH_TOKEN="${NODE_AUTH_TOKEN:-}"

health() {
  for _ in $(seq 1 30); do
    # Connection resets while containers start are expected; only the final result matters.
    if curl -fsS "http://127.0.0.1:$web_port/api/health" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
start() {
  # Check out the commit that matches the images so compose.yaml and migrations agree.
  git checkout --quiet --detach "$1"
  IMAGE_TAG="$1" docker compose up -d --wait db
  IMAGE_TAG="$1" docker compose up -d
}
# Pre-deploy dump: the server's backup command when the infrastructure installed one,
# otherwise a dump in backups/ (kept 14 days, ignored by Git).
backup() {
  if [ -x /usr/local/bin/money-backup ]; then
    /usr/local/bin/money-backup
    return
  fi
  mkdir -p backups
  docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
    gzip > "backups/predeploy-$(date +%Y%m%d-%H%M%S).sql.gz"
  find backups -name 'predeploy-*.sql.gz' -mtime +14 -delete
}

current=$(cat .deployed 2>/dev/null || true)
case "${1:-}" in
  deploy)
    ref=${2:?usage: remote-deploy.sh deploy <git ref>}
    git fetch --quiet --tags origin
    git checkout --quiet --detach "$ref"
    tag=$(git rev-parse --short=12 HEAD)
    echo "deploy $tag (previous: ${current:-none})"
    IMAGE_TAG="$tag" docker compose build
    if [ -n "$current" ]; then backup; fi
    IMAGE_TAG="$tag" docker compose up -d --wait db
    IMAGE_TAG="$tag" docker compose run --rm --no-deps \
      -v "$PWD/database/migrations:/database/migrations:ro" api node dist/migrate.js
    IMAGE_TAG="$tag" docker compose up -d
    if ! health; then
      echo "health check failed for $tag" >&2
      if [ -n "$current" ]; then
        start "$current"
        health && echo "restored $current" >&2
      fi
      exit 1
    fi
    if [ -n "$current" ] && [ "$current" != "$tag" ]; then echo "$current" > .previous; fi
    echo "$tag" > .deployed
    # Keep only the current and previous images. grep exits 1 when nothing is left to
    # remove, which must not fail an otherwise successful deploy under pipefail.
    keep="$tag|$(cat .previous 2>/dev/null || echo none)"
    # Split quotes keep the Go template away from the central template renderer.
    tag_format='{''{.Tag}}'
    for image in money-backend money-frontend; do
      docker image ls "$image" --format "$tag_format" | { grep -vxE "$keep" || true; } |
        xargs -r -I{} docker image rm "$image:{}" > /dev/null
    done
    # Repeated deploys must not grow the disk (and so the snapshot size) without bound.
    docker builder prune -f --filter until=168h > /dev/null
    echo "deployed $tag"
    ;;
  rollback)
    previous=$(cat .previous 2>/dev/null || true)
    if [ -z "$previous" ]; then echo "no previous deployment" >&2; exit 1; fi
    start "$previous"
    health
    echo "$current" > .previous
    echo "$previous" > .deployed
    # Keep the autodeploy timer from redeploying the same main commit right away;
    # it resumes with the next commit on main.
    git rev-parse --short=12 origin/main > .autodeploy-failed
    echo "rolled back to $previous"
    ;;
  *)
    echo "usage: remote-deploy.sh deploy <git ref> | rollback" >&2
    exit 2
    ;;
esac
