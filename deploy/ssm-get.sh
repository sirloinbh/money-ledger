#!/bin/bash
# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/deploy/에서
# Prints the value of one SecureString parameter from AWS SSM Parameter Store (ADR-0010).
#   ssm-get.sh <parameter name>     e.g. ssm-get.sh /sirloinbh/anthropic-api-key
# Signs the request with curl's built-in SigV4, so the server needs no AWS CLI. The key pair
# comes from the server .env (SECRETS_AWS_*) and goes to curl on standard input, never as an
# argument. The value goes to standard output only, for the caller to capture.
# Exit 3: no key pair in .env. Any other failure exits non-zero without printing the value.
set -euo pipefail
cd /opt/money-ledger
name=${1:?usage: ssm-get.sh <parameter name>}
if [[ ! "$name" =~ ^/[A-Za-z0-9/_.-]+$ ]]; then
  echo "invalid parameter name: $name" >&2
  exit 2
fi
env_value() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n 1 | tr -d "\"'\r"; }
region=$(env_value SECRETS_AWS_REGION)
region=${region:-ap-northeast-2}
id=$(env_value SECRETS_AWS_ACCESS_KEY_ID)
secret=$(env_value SECRETS_AWS_SECRET_ACCESS_KEY)
if [ -z "$id" ] || [ -z "$secret" ]; then
  echo "SECRETS_AWS_ACCESS_KEY_ID or SECRETS_AWS_SECRET_ACCESS_KEY is missing in .env" >&2
  exit 3
fi
response=$(printf 'user = "%s:%s"\n' "$id" "$secret" |
  curl -fsS -K - --aws-sigv4 "aws:amz:$region:ssm" \
    -H 'Content-Type: application/x-amz-json-1.1' \
    -H 'X-Amz-Target: AmazonSSM.GetParameter' \
    --data "{\"Name\":\"$name\",\"WithDecryption\":true}" \
    "https://ssm.$region.amazonaws.com/")
printf '%s' "$response" | python3 -c 'import json, sys; sys.stdout.write(json.load(sys.stdin)["Parameter"]["Value"])'
