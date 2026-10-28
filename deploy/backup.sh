#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Database backups of money-ledger on the Lightsail server (#262).
#   backup.sh dump [label]  pg_dump to /var/backups/money (14 days), row counts beside it,
#                           and a copy to S3 when the server .env names a bucket
#                           (exit 3: dumped, but the S3 copy failed)
#   backup.sh verify        restore the newest dump into a throwaway postgres container and
#                           compare its row counts with the ones taken at dump time
# Started daily by money-backup.timer, weekly by money-restore-check.timer,
# and by remote-deploy.sh before each deploy (label "predeploy").
set -euo pipefail
cd /opt/money-ledger
db=money
dir=/var/backups/$db
# Before install-backup.sh created the server folder, dumps stay in the app folder (ignored by Git).
if [ ! -w "$dir" ]; then dir=$PWD/backups; fi
mkdir -p "$dir"
# compose.yaml names images by ${IMAGE_TAG}; any value lets compose run commands in containers.
export IMAGE_TAG=${IMAGE_TAG:-$(cat .deployed 2>/dev/null || echo none)}

env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | tr -d "\"'\r"; }

# One exit handler: removes the restore-check container and sends the healthchecks.io signal
# (deploy/notify.sh, #284) for the nightly dump and the weekly restore check.
signal_check=""
signal_message=""
restore_container=""
finish() {
  local status=$?
  if [ -n "$restore_container" ]; then docker rm -f "$restore_container" > /dev/null 2>&1 || true; fi
  if [ -n "$signal_check" ] && [ -f deploy/notify.sh ]; then
    if [ "$status" -eq 0 ]; then
      bash deploy/notify.sh ping "$signal_check" ok "$signal_message" || true
    else
      bash deploy/notify.sh ping "$signal_check" fail "exit $status: $signal_message" || true
    fi
  fi
  exit "$status"
}
trap finish EXIT

# "schema.table|rows" for every table, sorted. Exact counts, so it is only run on small app DBs.
COUNT_SQL="select table_schema || '.' || table_name || '|' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema not in ('pg_catalog', 'information_schema') and table_type = 'BASE TABLE'
  order by 1"

# Uploads one file with SigV4 signing built into curl, so the server needs no AWS CLI.
# The key pair goes to curl on standard input and never appears in the process list or the log.
upload() {
  local file=$1 bucket region id secret
  bucket=$(env_value BACKUP_S3_BUCKET)
  if [ -z "$bucket" ]; then
    echo "S3 upload skipped: BACKUP_S3_BUCKET is not set in .env"
    return 0
  fi
  region=$(env_value BACKUP_S3_REGION)
  region=${region:-ap-northeast-2}
  id=$(env_value BACKUP_AWS_ACCESS_KEY_ID)
  secret=$(env_value BACKUP_AWS_SECRET_ACCESS_KEY)
  if [ -z "$id" ] || [ -z "$secret" ]; then
    echo "S3 upload failed: BACKUP_AWS_ACCESS_KEY_ID or BACKUP_AWS_SECRET_ACCESS_KEY is missing in .env" >&2
    return 1
  fi
  printf 'user = "%s:%s"\n' "$id" "$secret" |
    curl -fsS -K - --aws-sigv4 "aws:amz:$region:s3" \
      -H 'x-amz-content-sha256: UNSIGNED-PAYLOAD' \
      --upload-file "$file" "https://$bucket.s3.$region.amazonaws.com/money-ledger/$(basename "$file")" > /dev/null
  echo "uploaded money-ledger/$(basename "$file") to s3://$bucket"
}

dump() {
  local label=${1:-} name file
  # One dump at a time across the apps on the server, so they do not compete for memory.
  exec 8> /run/lock/apps-backup.lock
  flock -w 900 8 || { echo "another backup is running" >&2; exit 4; }
  name=$db-$(date +%F-%H%M%S)${label:+-$label}
  file=$dir/$name.sql.gz
  # --no-owner keeps the dump restorable into a database whose user has another name.
  docker compose exec -T db sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$file.part"
  mv "$file.part" "$file"
  # Row counts are for the weekly restore check only: a failure here must not fail the dump
  # (or block a deploy). Without the file, the next restore check reports it.
  if ! docker compose exec -T db sh -c 'psql -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$0"' "$COUNT_SQL" > "$dir/$name.counts"; then
    echo "row counts failed; $file has no .counts for the restore check" >&2
    rm -f "$dir/$name.counts"
  fi
  find "$dir" -maxdepth 1 \( -name "$db-*.sql.gz" -o -name "$db-*.counts" \) -mtime +14 -delete
  echo "dumped $file ($(du -h "$file" | cut -f1))"
  signal_message="$(basename "$file") $(du -h "$file" | cut -f1)"
  # Exit 3: the local dump is fine but the S3 copy failed. The timer shows it as failed;
  # a deploy goes on (remote-deploy.sh accepts 3).
  if ! { upload "$file" && { [ ! -f "$dir/$name.counts" ] || upload "$dir/$name.counts"; }; }; then
    echo "S3 copy failed; the local dump $file is kept" >&2
    exit 3
  fi
}

verify() {
  local latest counts image container
  latest=$(ls -1t "$dir"/"$db"-*.sql.gz 2>/dev/null | head -n 1 || true)
  if [ -z "$latest" ]; then echo "no dump in $dir" >&2; exit 1; fi
  counts=${latest%.sql.gz}.counts
  # The same postgres image as the running database. Split quotes keep the Go template away
  # from the central template renderer.
  image_format='{''{.Config.Image}}'
  image=$(docker inspect --format "$image_format" "$(docker compose ps -q db)")
  container=$db-restore-check
  docker rm -f "$container" > /dev/null 2>&1 || true
  restore_container=$container
  docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=restore-check -e POSTGRES_DB=restore_check "$image" > /dev/null
  for _ in $(seq 1 60); do
    if docker exec "$container" pg_isready -q -U postgres -d restore_check 2> /dev/null; then break; fi
    sleep 2
  done
  gunzip -c "$latest" | docker exec -i "$container" psql -q -v ON_ERROR_STOP=1 -U postgres -d restore_check > /dev/null
  docker exec "$container" psql -At -v ON_ERROR_STOP=1 -U postgres -d restore_check -c "$COUNT_SQL" > "$dir/.restore-check.counts"
  if [ ! -f "$counts" ]; then
    echo "restored $(basename "$latest"); no row counts saved with it to compare" >&2
    exit 1
  fi
  if ! diff -u "$counts" "$dir/.restore-check.counts"; then
    echo "restore check failed: row counts of $(basename "$latest") differ" >&2
    exit 1
  fi
  echo "restore check passed: $(basename "$latest"), $(wc -l < "$counts") tables"
  signal_message="$(basename "$latest"), $(wc -l < "$counts") tables"
}

case "${1:-}" in
  dump)
    # Pre-deploy dumps (with a label) are not the nightly backup and send no signal.
    if [ -z "${2:-}" ]; then signal_check=backup; fi
    dump "${2:-}"
    ;;
  verify)
    signal_check=restore
    verify
    ;;
  *)
    echo "usage: backup.sh dump [label] | verify" >&2
    exit 2
    ;;
esac
