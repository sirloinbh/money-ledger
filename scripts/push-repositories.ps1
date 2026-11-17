# Managed file. Edit it in sirloinbh/project-standards templates/app/scripts/
# Sync the deploy sub-repositories from this umbrella monorepo. Run only when the user asks.
# This script only pushes each part to its own sub-repo. It never pushes the umbrella main and never
# adds commits to the checked-out branch (no --rejoin). The umbrella main changes only through PRs.
$ErrorActionPreference = 'Stop'
$repos = @{ frontend='money-ledger-frontend'; backend='money-ledger-backend'; database='money-ledger-db' }
foreach ($part in $repos.Keys) {
    & git remote get-url $part | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Remote '$part' is missing. Add it with: git remote add $part https://github.com/sirloinbh/$($repos[$part]).git"
    }
}
foreach ($part in $repos.Keys) {
    $branch = "export/$part"
    try {
        & git subtree split --prefix=$part --branch=$branch
        if ($LASTEXITCODE -ne 0) { throw "Split failed: $part" }
        & git push $part "${branch}:main"
        if ($LASTEXITCODE -ne 0) { throw "Push failed: $part" }
    }
    finally {
        & git branch --delete --force $branch | Out-Null
    }
}
