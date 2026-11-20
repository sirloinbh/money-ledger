#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/deploy/deploy/
# Runs on the Lightsail server from /opt/money-ledger, started by scripts/deploy.ps1 or
# by autodeploy.sh.
#   deploy <ref>  build the commit, back up, migrate, start, health check; on failure
#                 start the previous images again
#   rollback [tag] start the previously deployed images again, or the images of an earlier commit tag
# Images are tagged by commit, so a rollback does not rebuild. Migrations are
# forward-only; restoring data from the pre-deploy dump is a separate, manual step.
# compose.yaml must tag the images `money-backend money-frontend` as <image>:${IMAGE_TAG} and publish the web
# port as ${WEB_BIND}:${WEB_PORT}. One script serves the apps and the shared services (#696): the
# registry values below decide whether migrations are a deploy step (apps) or run inside the image (services).
set -euo pipefail
cd /opt/money-ledger
# One deploy at a time across every app on the server (ADR-0009). The autodeploy timer
# already holds the lock and sets the flag.
if [ -z "${APPS_DEPLOY_LOCKED:-}" ]; then
  exec 9> /run/lock/apps-deploy.lock
  flock -w 1800 9 || { echo "another deploy is running" >&2; exit 4; }
fi
# A project that creates its own .env on the first deploy (the shared services: DB password, URLs) ships
# deploy/bootstrap-env.sh for it; it is not a managed file.
if [ ! -f .env ] && [ -f deploy/bootstrap-env.sh ]; then bash deploy/bootstrap-env.sh; fi

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
# Keys from AWS SSM (ADR-0010, ADR-0014): every .env.example key whose comment line has
# @ssm=<parameter> is read on each deploy and exported, so compose passes it to the containers
# and the server .env holds no copy. Apps with features.claude also get ANTHROPIC_API_KEY from
# /sirloinbh/shared/anthropic-api-key when .env.example does not tag it. The SSM key pair is in
# the shared server file /opt/project-standards/.env (or the app .env). Without it, or when a
# read fails, a value already in .env stays in use. Values are never printed. A key whose comment
# line also has @required must be readable: the deploy stops when it is not (#696).
ssm_keys() {
  awk '
    /^[[:space:]]*#/ { tag = ""; req = ($0 ~ /@required/) ? 1 : 0; if (match($0, /@ssm=[^[:space:]@]+/)) tag = substr($0, RSTART + 5, RLENGTH - 5); next }
    /^[A-Z][A-Z0-9_]*=/ { if (tag != "") { sub(/=.*/, ""); print $0, tag, req }; tag = ""; next }
    { tag = "" }
  ' .env.example 2> /dev/null || true
}
load_ssm_env() {
  local list key name required value have_pair=1
  grep -qs '^SECRETS_AWS_ACCESS_KEY_ID=.' "${STANDARDS_ENV_FILE:-/opt/project-standards/.env}" .env || have_pair=0
  list=$(ssm_keys)
  if [ "false" = true ] && ! printf '%s\n' "$list" | grep -q '^ANTHROPIC_API_KEY '; then
    list=$(printf '%s\n%s' "$list" 'ANTHROPIC_API_KEY /sirloinbh/shared/anthropic-api-key 0')
  fi
  while read -r key name required; do
    [ -n "$key" ] || continue
    # Without a key pair only a required key is a problem; the others keep their .env value as before.
    if [ "$have_pair" = 0 ] && [ "${required:-0}" != 1 ]; then continue; fi
    if value=$(bash deploy/ssm-get.sh "$name"); then
      export "$key=$value"
    elif [ "${required:-0}" = 1 ]; then
      echo "error: could not read $key from SSM ($name); it is marked @required" >&2
      return 1
    else
      echo "warning: could not read $key from SSM ($name); using the .env value if there is one" >&2
    fi
  done <<< "$list"
}

# The private network shared-ai (ADR-0017) is external in compose.yaml, and the shared-ai service
# may not be deployed yet, so it is created here when compose.yaml uses it and it is missing.
ensure_networks() {
  grep -qE '^[[:space:]]+shared-ai:' compose.yaml 2> /dev/null || return 0
  docker network inspect shared-ai > /dev/null 2>&1 || docker network create shared-ai > /dev/null
}

health() {
  for _ in $(seq 1 30); do
    # Connection resets while containers start are expected; only the final result matters.
    if curl -fsS "http://127.0.0.1:$web_port/api/health" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
# Docker drops a replaced container's logs, so its error lines since the last report (.report-last-sent,
# written by deploy/report.sh; 24 hours when missing) go to a file that deploy/report.sh counts with the
# live logs and then empties (ADR-0021, #644). Nothing here may fail a deploy: no running api container,
# or any docker error, is skipped quietly.
save_api_errors() {
  local since=24h last_sent
  if [ -f .report-last-sent ]; then
    last_sent=$(tr -d '\r\n' < .report-last-sent 2> /dev/null || true)
    case "$last_sent" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z) since=$last_sent ;; esac
  fi
  [ -n "$(IMAGE_TAG="${IMAGE_TAG:-none}" docker compose ps -q api 2> /dev/null)" ] || return 0
  IMAGE_TAG="${IMAGE_TAG:-none}" docker compose logs --no-log-prefix --since "$since" api 2> /dev/null |
    { grep -F '"level":"error"' || true; } >> .errors-before-deploy.log 2> /dev/null || true
  return 0
}
# Pulls the images CI pushed for a commit (ADR-0023, #755) and tags them with the local names compose.yaml uses, so
# `docker compose up` finds them and builds nothing. Logs in with the server .env token (read:packages), which is
# exported above. Any failure returns non-zero and the caller falls back to the local build.
pull_images() {
  local image
  [ -n "${NODE_AUTH_TOKEN:-}" ] || { echo "no NODE_AUTH_TOKEN for ghcr.io; building here" >&2; return 1; }
  printf '%s' "$NODE_AUTH_TOKEN" | docker login ghcr.io -u sirloinbh --password-stdin > /dev/null || return 1
  for image in money-backend money-frontend; do
    docker pull --quiet "ghcr.io/sirloinbh/$image:$1" > /dev/null || return 1
    docker tag "ghcr.io/sirloinbh/$image:$1" "$image:$1" || return 1
  done
}
start() {
  # Check out the commit that matches the images so compose.yaml and migrations agree.
  git checkout --quiet --detach "$1"
  load_ssm_env
  save_api_errors
  ensure_networks
  IMAGE_TAG="$1" docker compose up -d --wait db
  IMAGE_TAG="$1" docker compose up -d
}
# Pre-deploy dump with the same script as the nightly one (deploy/backup.sh, #262): kept with
# the nightly dumps for 14 days and copied to S3 when the server .env names a bucket.
backup() {
  # 3 means only the S3 copy failed; the local dump exists, so the deploy goes on.
  IMAGE_TAG="$current" bash deploy/backup.sh dump predeploy || [ $? -eq 3 ]
}

current=$(cat .deployed 2>/dev/null || true)
case "${1:-}" in
  deploy)
    ref=${2:?usage: remote-deploy.sh deploy <git ref>}
    git fetch --quiet --tags origin
    git checkout --quiet --detach "$ref"
    load_ssm_env
    tag=$(git rev-parse --short=12 HEAD)
    echo "deploy $tag (previous: ${current:-none})"
    # Pulling is on (off until the quota is confirmed, #756). When on, the CI image for this commit is
    # pulled instead of built here; a missing image falls back to the build, so an app can move before its first push.
    if [ "on" = on ] && pull_images "$tag"; then
      echo "pulled $tag from ghcr.io/sirloinbh"
    else
      IMAGE_TAG="$tag" docker compose build
    fi
    if [ -n "$current" ]; then backup; fi
    ensure_networks
    IMAGE_TAG="$tag" docker compose up -d --wait db
    # Apps migrate as a step with the migrations mounted; a shared service's image runs them when it starts.
    if [ "step" = step ]; then
      IMAGE_TAG="$tag" docker compose run --rm --no-deps \
        -v "$PWD/database/migrations:/app/database/migrations:ro" api node dist/migrate.js
    fi
    save_api_errors
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
    # Pulled images carry two names, the local one compose uses and the ghcr.io/sirloinbh/ one (#755); an
    # image is freed only when both names are gone, so both repositories are pruned (#870). Without pulls the second one is empty.
    for image in money-backend money-frontend; do
      for repo in "$image" "ghcr.io/sirloinbh/$image"; do
        docker image ls "$repo" --format "$tag_format" | { grep -vxE "$keep" || true; } |
          xargs -r -I{} docker image rm "$repo:{}" > /dev/null
      done
    done
    # Repeated deploys must not grow the disk (and so the snapshot size) without bound.
    docker builder prune -f --filter until=168h > /dev/null
    echo "deployed $tag"
    ;;
  rollback)
    # `rollback <tag>` starts any earlier commit tag (pulled when pulling is on); without a tag it is the previous one.
    previous=${2:-$(cat .previous 2>/dev/null || true)}
    if [ -z "$previous" ]; then echo "no previous deployment" >&2; exit 1; fi
    if [ -n "${2:-}" ] && [ "on" = on ]; then
      git fetch --quiet --tags origin
      pull_images "$previous" || echo "could not pull $previous; using the local image if there is one" >&2
    fi
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
    echo "usage: remote-deploy.sh deploy <git ref> | rollback [tag]" >&2
    exit 2
    ;;
esac
