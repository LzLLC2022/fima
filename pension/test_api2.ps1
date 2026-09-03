$rebalJson = @{
    owner = "Forest"
    region = "Korea"
} | ConvertTo-Json -Depth 2
$rebalBytes = [System.Text.Encoding]::UTF8.GetBytes($rebalJson)
$res = Invoke-RestMethod -Uri "https://fima.lim.kr/api/rebalancing" -Method POST -Body $rebalBytes -ContentType "application/json; charset=utf-8"
Write-Host "Success: $($res.success)"
$res.items | Select-Object ticker, targetPct | ConvertTo-Json
