# Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/
# Sync the deploy sub-repositories from this umbrella monorepo. Run only when the user asks.
$ErrorActionPreference = 'Stop'
$repos = @{ frontend='money-ledger-frontend'; backend='money-ledger-backend'; database='money-ledger-db' }
foreach ($part in $repos.Keys) {
    $branch = "export/$part"
    & git subtree split --prefix=$part --branch=$branch --rejoin
    if ($LASTEXITCODE -ne 0) { throw "Split failed: $part" }
    & git push $part "${branch}:main"
    if ($LASTEXITCODE -ne 0) { throw "Push failed: $part" }
}
& git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Umbrella push failed' }
