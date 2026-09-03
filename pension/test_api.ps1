$bodyJson = @{
    owner = "Forest"
    accountOwner = "Forest"
    account = "연금"
} | ConvertTo-Json -Depth 2
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
$fimaRes = Invoke-RestMethod -Uri "https://fima.lim.kr/api/portfolio" -Method POST -Body $bodyBytes -ContentType "application/json; charset=utf-8"
Write-Host "Success: $($fimaRes.success)"
Write-Host "Cash: $($fimaRes.totalCashKRW)"
Write-Host "Stocks Count: $($fimaRes.stocks.Count)"
foreach ($s in $fimaRes.stocks) {
    Write-Host "Ticker: $($s.ticker), avgPrice: $($s.avgPrice), quantity: $($s.quantity)"
}
