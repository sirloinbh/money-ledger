#!/bin/bash
# Managed file. Edit it in sirloinbh/project-standards templates/app/deploy/
# Creates the server .env on the first deploy; deploy/remote-deploy.sh runs it only when .env is missing,
# so a server that already has a .env is untouched. The DB password is generated once and stays on the server.
# It writes no token and no SSM key: NODE_AUTH_TOKEN (private npm packages) and the SSM keys stay separate steps.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
{
  printf 'POSTGRES_DB=%s\n' 'money'
  printf 'POSTGRES_USER=%s\n' 'money'
  printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
  printf 'WEB_BIND=127.0.0.1\n'
  printf 'WEB_PORT=%s\n' '8105'
} > .env
chmod 600 .env
echo "deploy: created .env with a new DB password"
