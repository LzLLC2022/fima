$configPath = Join-Path $PSScriptRoot "portfolio_config.json"
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$targetOwner = $config.Target.'Account Owner'
$targetAccount = $config.Target.Account

$bodyJson = @{
    owner = $targetOwner
    accountOwner = $targetOwner
    account = $targetAccount
} | ConvertTo-Json -Depth 2

$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
$fimaRes = Invoke-RestMethod -Uri "https://fima.lim.kr/api/portfolio" -Method POST -Body $bodyBytes -ContentType "application/json; charset=utf-8"

$fimaHoldings = @{}
if ($null -ne $fimaRes.stocks) { 
    foreach ($s in $fimaRes.stocks) { 
        $fimaHoldings[$s.ticker] = $s
    }
}

Write-Host "Target Account: $targetAccount"
Write-Host "Stocks count from API: $($fimaRes.stocks.Count)"
Write-Host "fimaHoldings keys: $($fimaHoldings.Keys -join ', ')"

foreach ($item in $config.portfolio.holdings) {
    $found = $fimaHoldings.ContainsKey($item.ticker)
    Write-Host "Ticker: $($item.ticker), Found: $found"
}
