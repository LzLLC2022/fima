$env:GMAIL_APP_PASSWORD = 'dummy'
$scriptPath = "d:\Repos\fima\pension\scripts\monthly_reporter.ps1"
$content = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)
$content = $content -replace '\$smtpClient\.Send\(\$msg\)', '[System.IO.File]::WriteAllText("preview.html", $msg.Body, [System.Text.Encoding]::UTF8)'
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText("d:\Repos\fima\pension\scripts\test_monthly_gen.ps1", $content, $utf8Bom)
