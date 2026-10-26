# Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path "$PSScriptRoot/../backups" | Out-Null
$backupPath = Join-Path "$PSScriptRoot/../backups" ("money-ledger-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
# pg_dump writes inside the container and the file is copied byte for byte (workout-memo #55).
# Capturing its stdout in Windows PowerShell decodes UTF-8 with the console code page
# (CP949 on Korean Windows), which corrupted Korean text in the backup file.
$tmp = '/tmp/money-ledger-backup.sql'
& docker compose exec -T db sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --no-owner --no-acl -f $tmp"
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
try {
  & docker compose cp "db:$tmp" $backupPath
  if ($LASTEXITCODE -ne 0) { throw 'copying the backup out of the container failed' }
} finally {
  & docker compose exec -T db rm -f $tmp
}
Write-Output "Backup: $backupPath"
