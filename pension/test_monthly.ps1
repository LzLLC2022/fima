$env:GMAIL_APP_PASSWORD = 'dummy'
try {
    .\scripts\monthly_reporter.ps1
} catch {
    Write-Host "Error: $_"
}
