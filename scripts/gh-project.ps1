# Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$GhArguments
)
$ErrorActionPreference = 'Stop'
if (-not $env:USERPROFILE) { throw 'USERPROFILE is required.' }
$ghExecutable = (Get-Command gh -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$names = @('GH_CONFIG_DIR', 'GH_TOKEN', 'GITHUB_TOKEN')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$ghExitCode = 1
try {
    $env:GH_CONFIG_DIR = Join-Path $env:USERPROFILE '.config/gh-personal'
    Remove-Item Env:GH_TOKEN, Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
    $isAuthManagement = $GhArguments.Count -ge 1 -and $GhArguments[0] -eq 'auth' -and ($GhArguments.Count -lt 2 -or $GhArguments[1] -ne 'git-credential')
    if (-not $isAuthManagement) {
        # Explicit account lookup avoids the shared Windows keyring's active-token slot.
        $accountToken = & $ghExecutable auth token --hostname github.com --user sirloinbh 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $accountToken) { throw 'Authenticate sirloinbh in the project gh configuration first.' }
        $env:GH_TOKEN = $accountToken.Trim()
        $accountToken = $null
    }
    if ($GhArguments.Count -ge 2 -and $GhArguments[0] -eq 'auth' -and $GhArguments[1] -eq 'git-credential') {
        # Git sends the credential request on stdin. Never print it.
        $request = [Console]::In.ReadToEnd()
        $request | & $ghExecutable @GhArguments
    } else {
        & $ghExecutable @GhArguments
    }
    $ghExitCode = $LASTEXITCODE
} finally {
    foreach ($name in $names) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
exit $ghExitCode
