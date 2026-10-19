$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path "$PSScriptRoot/../backups" | Out-Null
$backupPath = Join-Path "$PSScriptRoot/../backups" ("money-ledger-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql')
$dump = & docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl'
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
[System.IO.File]::WriteAllText($backupPath, ($dump -join "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Output "Backup: $backupPath"
