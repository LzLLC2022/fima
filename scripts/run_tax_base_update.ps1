$ErrorActionPreference = "Stop"

# Set working directory to the repo root
$RepoDir = "d:\Repos\fima"
Set-Location -Path $RepoDir

# run_tax_base_update.ps1 no longer requires KSD_API_KEY

# Run node script
node scripts/scrape_tax_base.js
$nodeExitCode = $LASTEXITCODE

if ($nodeExitCode -ne 0) {
    Write-Error "Node script exited with code $nodeExitCode"
    exit $nodeExitCode
}

# Check for git changes
$gitStatus = git status --porcelain public/data/tax_base.json
if ($gitStatus) {
    Write-Host "Changes detected in tax_base.json. Committing and pushing..."
    git config user.name "local-automation"
    git config user.email "local-automation@lim.kr"
    git add public/data/tax_base.json
    git commit -m "chore(data): auto-update etf tax base data (local scheduler)"
    git push
} else {
    Write-Host "No changes in tax_base.json."
}
