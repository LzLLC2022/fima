# Ensure paths are correct
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$configPath = Join-Path $scriptDir "..\portfolio_config.json"
$templatePath = Join-Path $scriptDir "..\resources\report_template.html"

# Load Config & Template
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$template = Get-Content $templatePath -Raw -Encoding UTF8

$sender = $config.email.sender_address
$receiver = $config.email.receiver_address
$password = $config.email.app_password
if ($password -eq "ENV_GMAIL_APP_PASSWORD") {
    $password = $env:GMAIL_APP_PASSWORD
}

if ($password -eq "YOUR_APP_PASSWORD_HERE" -or [string]::IsNullOrWhiteSpace($password)) {
    Write-Host "No app password set."
    exit
}

$totalInvest = 0
$cash = 0

# Fetch from FiMa API to dynamically update portfolio holdings, cash, and target weights
if ($null -ne $config.Target) {
    $targetOwner = $config.Target.'Account Owner'
    $targetAccount = $config.Target.Account
    $targetRegion = $config.Target.Region
    if ($null -ne $targetOwner -and $null -ne $targetAccount) {
        $bodyJson = @{
            owner = $targetOwner
            accountOwner = $targetOwner
            account = $targetAccount
        } | ConvertTo-Json -Depth 2
        
        # GitHub Actions (windows-latest) 환경에서 한글 깨짐을 방지하기 위해 UTF-8 바이트 배열로 변환
        $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyJson)
        
        $rebalJson = @{
            owner = $targetOwner
            region = $targetRegion
        } | ConvertTo-Json -Depth 2
        $rebalBytes = [System.Text.Encoding]::UTF8.GetBytes($rebalJson)
        
        try {
            $fimaRes = Invoke-RestMethod -Uri "https://fima.lim.kr/api/portfolio" -Method POST -Body $bodyBytes -ContentType "application/json; charset=utf-8"
            $rebalRes = Invoke-RestMethod -Uri "https://fima.lim.kr/api/rebalancing" -Method POST -Body $rebalBytes -ContentType "application/json; charset=utf-8"
            
            if ($fimaRes.success -eq $true) {
                $cash = $fimaRes.totalCashKRW
                $totalInvest = $cash
                
                $fimaHoldings = @{}
                if ($null -ne $fimaRes.stocks) { 
                    foreach ($s in $fimaRes.stocks) { 
                        $fimaHoldings[$s.ticker] = $s
                        $totalInvest += $s.purchaseAmt
                    }
                }
                if ($null -ne $fimaRes.funds) { 
                    foreach ($f in $fimaRes.funds) { 
                        $fimaHoldings[$f.ticker] = $f
                        $totalInvest += $f.purchaseAmt
                    }
                }
                
                $rebalMap = @{}
                if ($null -ne $rebalRes.items) {
                    foreach ($r in $rebalRes.items) {
                        $rebalMap[$r.ticker] = $r.targetPct
                    }
                }
                
                $newHoldings = @()
                foreach ($item in $config.portfolio.holdings) {
                    if ($rebalMap.ContainsKey($item.ticker)) {
                        $item | Add-Member -NotePropertyName "target_weight" -NotePropertyValue $rebalMap[$item.ticker] -Force
                    } else {
                        $item | Add-Member -NotePropertyName "target_weight" -NotePropertyValue 0.0 -Force
                    }

                    if ($fimaHoldings.ContainsKey($item.ticker)) {
                        $fi = $fimaHoldings[$item.ticker]
                        $item | Add-Member -NotePropertyName "shares" -NotePropertyValue $fi.quantity -Force
                        $item | Add-Member -NotePropertyName "avg_price" -NotePropertyValue $fi.avgPrice -Force
                        $fimaHoldings.Remove($item.ticker)
                    } else {
                        $item | Add-Member -NotePropertyName "shares" -NotePropertyValue 0 -Force
                        $item | Add-Member -NotePropertyName "avg_price" -NotePropertyValue 0 -Force
                    }
                    $newHoldings += $item
                }
                
                foreach ($fi in $fimaHoldings.Values) {
                    if ($fi.quantity -gt 0) {
                        $tw = 0.0
                        if ($rebalMap.ContainsKey($fi.ticker)) { $tw = $rebalMap[$fi.ticker] }
                        $newItem = [PSCustomObject]@{
                            ticker = $fi.ticker
                            name = $fi.name
                            category = "기타"
                            target_weight = $tw
                            shares = $fi.quantity
                            avg_price = $fi.avgPrice
                        }
                        $newHoldings += $newItem
                    }
                }
                $config.portfolio.holdings = $newHoldings
            }
        } catch {
            Write-Host "Failed to fetch from FiMa API: $_"
        }
    }
}

$totalEval = $cash
$totalChange = 0
$totalPurchase = $cash

$assetRows = ""
$rebalancingRows = ""
$tickerRows = ""
$dividendRows = ""

$ttmDivDict = @{}
$totalAnnualDiv = 0
$totalProjectedAnnualDiv = 0

$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$oneYearAgo = $now - (365 * 24 * 3600)

$lastTradingDateStr = ""

foreach ($item in $config.portfolio.holdings) {
    if ($item.ticker -eq "-" -or $item.ticker -eq "") { continue }

    $rawCat = $item.category
    $displayCat = "기타"
    if ($rawCat -match "안전" -or $rawCat -match "현금") { $displayCat = "현금자산" }
    elseif ($rawCat -match "확정") { $displayCat = "확정인컴" }
    elseif ($rawCat -match "변동") { $displayCat = "변동인컴" }
    elseif ($rawCat -match "파생") { $displayCat = "파생인컴" }
    elseif ($rawCat -match "성장") { $displayCat = "성장자산" }
    $item.category = $displayCat

    $rank = 6
    if ($displayCat -eq "현금자산") { $rank = 1 }
    elseif ($displayCat -eq "확정인컴") { $rank = 2 }
    elseif ($displayCat -eq "변동인컴") { $rank = 3 }
    elseif ($displayCat -eq "파생인컴") { $rank = 4 }
    elseif ($displayCat -eq "성장자산") { $rank = 5 }
    $item | Add-Member -NotePropertyName "Rank" -NotePropertyValue $rank -Force
}

$config.portfolio.holdings = $config.portfolio.holdings | Sort-Object Rank

$logHoldings = @{}
$logPrices = @{}

foreach ($item in $config.portfolio.holdings) {
    if ($item.ticker -eq "-" -or $item.ticker -eq "") { continue }

    try {
        # Fetch Price from Naver Polling API (Supports ETN/Fund codes like 0018C0)
        $url = "https://polling.finance.naver.com/api/realtime/domestic/stock/$($item.ticker)"
        $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "Mozilla/5.0" } -ErrorAction SilentlyContinue
        
        $close = 0
        $compare = 0
        $fetchSuccess = $false
        if ($null -ne $response -and $null -ne $response.datas -and $response.datas.Count -gt 0) {
            $data = $response.datas[0]
            $close = [int]($data.closePriceRaw)
            $compare = [int]($data.compareToPreviousClosePriceRaw)
            $fetchSuccess = $true
            $tDate = $data.localTradedAt
            if ($null -ne $tDate -and [string]::IsNullOrEmpty($lastTradingDateStr) -and $tDate.Length -ge 10) {
                $lastTradingDateStr = $tDate.Substring(5, 2) + "월 " + $tDate.Substring(8, 2) + "일"
            }
        } else {
            # Fallback if Naver fails
            $close = 0
            $compare = 0
        }
        
        $logPrice = $close
        $logHoldings[$item.ticker] = @{ shares = $item.shares; avg_price = $item.avg_price }
        $logPrices[$item.ticker] = $logPrice
        
        # Fetch Dividends from Yahoo Finance (TTM)
        $ttmDiv = 0
        try {
            $divUrl = "https://query1.finance.yahoo.com/v8/finance/chart/$($item.ticker).KS?interval=1d&range=2y&events=dividends"
            $divResponse = Invoke-RestMethod -Uri $divUrl -Headers @{ "User-Agent" = "Mozilla/5.0" } -ErrorAction Stop
            if ($null -ne $divResponse -and $null -ne $divResponse.chart -and $null -ne $divResponse.chart.result -and $divResponse.chart.result.Count -gt 0 -and $null -ne $divResponse.chart.result[0].events -and $null -ne $divResponse.chart.result[0].events.dividends) {
                $divEvents = $divResponse.chart.result[0].events.dividends
                foreach ($key in $divEvents.PSObject.Properties.Name) {
                    $divData = $divEvents.$key
                    if ($divData.date -ge $oneYearAgo) {
                        $ttmDiv += $divData.amount
                    }
                }
            }
        } catch {
            Write-Host "Yahoo Div fetch failed for $($item.ticker), using 0"
        }
        $ttmDiv = [math]::Round($ttmDiv, 2)
        $ttmDivDict[$item.ticker] = $ttmDiv
        
        # Calculations
        $evalVal = $close * $item.shares
        $evalChange = $compare * $item.shares
        $purchaseVal = $item.avg_price * $item.shares
        $pnl = $evalVal - $purchaseVal
        $pnlRatio = 0
        if ($purchaseVal -gt 0) { $pnlRatio = [math]::Round(($pnl / $purchaseVal) * 100, 2) }
        
        $totalEval += $evalVal
        $totalChange += $evalChange
        $totalPurchase += $purchaseVal
        
        $annualDiv = $ttmDiv * $item.shares
        $monthlyDiv = $annualDiv / 12
        $divYield = 0
        if ($close -gt 0) { $divYield = [math]::Round(($ttmDiv / $close) * 100, 2) }
        $totalAnnualDiv += $annualDiv
        
        $prevClose = $close - $compare
        $changeRatioStr = "-"
        if ($prevClose -gt 0) {
            $changeRatio = [math]::Round(($compare / $prevClose) * 100, 2)
            $changeRatioStr = "$changeRatio%"
        }

        $color = "black"; $signHTML = "-"; $signWord = "-"
        if ($compare -gt 0) { $color = "red"; $signHTML = "&#9650;"; $signWord = "+" }
        elseif ($compare -lt 0) { $color = "blue"; $signHTML = "&#9660;"; $signWord = "-" }
        $absComp = [math]::Abs($compare)
        
        $pnlColor = "black"
        if ($pnl -gt 0) { $pnlColor = "red" } elseif ($pnl -lt 0) { $pnlColor = "blue" }
        
        # Format strings safely
        $fClose = "{0:N0}" -f $close
        $fAbsComp = "{0:N0}" -f $absComp
        $fEval = "{0:N0}" -f $evalVal
        $fPurch = "{0:N0}" -f $purchaseVal
        $fPnl = "{0:N0}" -f $pnl
        
        $nameLink = "<a href='https://finance.naver.com/item/main.naver?code=$($item.ticker)' target='_blank' style='text-decoration:none; color:inherit;'>$($item.name)</a>"
        # ASSET ROWS
        $assetRows += "<tr><td>$($item.category)</td><td>$nameLink</td><td>$fClose</td><td style='color:$color;'>$signHTML $fAbsComp ($changeRatioStr)</td><td>$fPurch</td><td>$fEval</td><td>{{WEIGHT_$($item.ticker)}}</td><td style='color:$pnlColor;'>$fPnl ($pnlRatio%)</td></tr>`n"
        $divYieldStr = "$divYield%"
        if ($divYield -eq 0) { $divYieldStr = "-" }
        
        $rowStyle = ""
        if ($item.category -eq "확정인컴" -or $item.category -eq "파생인컴") {
            $rowStyle = " style='background-color:#f5f5f5;'"
        }
        
        # REBALANCING ROWS
        $chartImg = "<img src='https://ssl.pstatic.net/imgfinance/chart/item/area/year/$($item.ticker).png' style='width:120px; height:40px; vertical-align:middle; border-radius:3px; filter: hue-rotate(-130deg) saturate(400%) contrast(1.3) brightness(0.9); mix-blend-mode: multiply;'>"
        $rebalancingRows += "<tr$rowStyle><td>$($item.category)</td><td>$nameLink</td><td>$($item.target_weight)%</td><td>{{TARGET_AMT_$($item.ticker)}}</td><td>{{WEIGHT_$($item.ticker)}}</td><td>$fPurch</td><td>$fEval</td><td>{{ACHIEVE_$($item.ticker)}}</td><td>$fClose</td><td>$divYieldStr</td><td>{{NEED_AMT_$($item.ticker)}}</td><td style='text-align:center;'>$chartImg</td></tr>`n"
        
        # DIVIDEND ROWS
        $fTtmDiv = "{0:N0}" -f $ttmDiv
        $fAnnual = "{0:N0}" -f $annualDiv
        $fMonthly = "{0:N0}" -f $monthlyDiv
        $dividendRows += "<tr><td>$nameLink</td><td>$fTtmDiv</td><td>$($item.shares)</td><td>$divYield%</td><td>$fAnnual</td><td>$fMonthly</td></tr>`n"

    } catch {
        Write-Host "Error fetching $($item.ticker): $_"
    }
}

if ([string]::IsNullOrEmpty($lastTradingDateStr)) {
    $lastTradingDateStr = (Get-Date).ToString("MM월 dd일")
}

$fCash = "{0:N0}" -f $cash
$fCash = "{0:N0}" -f $cash
$assetRows = "<tr><td>현금 자산</td><td>대기 자금</td><td>-</td><td>-</td><td>$fCash</td><td>$fCash</td><td>{{WEIGHT_CASH}}</td><td>-</td></tr>`n" + $assetRows

# Add Cash to Rebalancing Rows
$totalTargetWeight = 0.0
foreach ($h in $config.portfolio.holdings) { $totalTargetWeight += $h.target_weight }
$cashTargetWeight = [math]::Round(100.0 - $totalTargetWeight, 1)
if ($cashTargetWeight -lt 0) { $cashTargetWeight = 0.0 }
$cashTargetAmt = $totalEval * ($cashTargetWeight / 100)
$cashNeedAmt = $cashTargetAmt - $cash
$cashAchieve = 0; if ($cashTargetAmt -gt 0) { $cashAchieve = [math]::Round(($cash / $cashTargetAmt) * 100, 0) }
$cashNeedStr = ""
if ($cashNeedAmt -gt 0) { $cashNeedStr = "<span style='color:red;'>$("{0:N0}" -f $cashNeedAmt) 확보필요</span>" }
elseif ($cashNeedAmt -lt 0) { $cashNeedStr = "<span style='color:blue;'>$("{0:N0}" -f [math]::Abs($cashNeedAmt)) 매수활용</span>" }
else { $cashNeedStr = "완료" }
$cashRebalanceRow = "<tr><td>현금 자산</td><td>현금 자산</td><td>$cashTargetWeight%</td><td>$("{0:N0}" -f $cashTargetAmt)</td><td>{{WEIGHT_CASH}}</td><td>$fCash</td><td>$fCash</td><td>$cashAchieve%</td><td>-</td><td>-</td><td>$cashNeedStr</td><td style='text-align:center; color:#ccc;'>-</td></tr>`n"
$rebalancingRows = $cashRebalanceRow + $rebalancingRows

# Add Totals for Tables
$totalPnl = $totalEval - $totalPurchase
$totalPnlRatio = 0; if ($totalPurchase -gt 0) { $totalPnlRatio = [math]::Round(($totalPnl / $totalPurchase) * 100, 2) }
$totalPnlColor = "black"; if ($totalPnl -gt 0) { $totalPnlColor = "red" } elseif ($totalPnl -lt 0) { $totalPnlColor = "blue" }
$assetTotalRow = "<tr style='font-weight:bold; background-color:#fcfcfc;'><td colspan='4'>합계</td><td>$("{0:N0}" -f $totalPurchase)</td><td>$("{0:N0}" -f $totalEval)</td><td>100%</td><td style='color:$totalPnlColor;'>$("{0:N0}" -f $totalPnl) ($totalPnlRatio%)</td></tr>"

$rebalancingTotalRow = "<tr style='font-weight:bold; background-color:#fcfcfc;'><td colspan='2'>합계</td><td>100%</td><td>$("{0:N0}" -f $totalEval)</td><td>100%</td><td>$("{0:N0}" -f $totalPurchase)</td><td>$("{0:N0}" -f $totalEval)</td><td>-</td><td>-</td><td>-</td><td>{{TOTAL_NEED_STR}}</td><td></td></tr>"

$totalBuyAmt = 0
$totalSellAmt = 0
if ($cashNeedAmt -gt 0) { $totalBuyAmt += $cashNeedAmt }
elseif ($cashNeedAmt -lt 0) { $totalSellAmt += [math]::Abs($cashNeedAmt) }

$template = $template -replace '\{\{ASSET_ROWS\}\}', $assetRows
$template = $template -replace '\{\{ASSET_TOTAL_ROW\}\}', $assetTotalRow
$template = $template -replace '\{\{REBALANCING_ROWS\}\}', $rebalancingRows
$template = $template -replace '\{\{REBALANCING_TOTAL_ROW\}\}', $rebalancingTotalRow
$template = $template -replace '\{\{DIVIDEND_ROWS\}\}', $dividendRows
$template = $template -replace '\{\{LAST_TRADING_DATE\}\}', $lastTradingDateStr

$cashWeight = 0; if ($totalEval -gt 0) { $cashWeight = [math]::Round(($cash / $totalEval) * 100, 1) }
$template = $template -replace '\{\{WEIGHT_CASH\}\}', "$cashWeight%"

$step1 = ""
$step2 = ""
$step3 = ""
$step4 = ""

foreach ($item in $config.portfolio.holdings) {
    if ($item.ticker -eq "-" -or $item.ticker -eq "") { continue }
    $url = "https://polling.finance.naver.com/api/realtime/domestic/stock/$($item.ticker)"
    $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "Mozilla/5.0" } -ErrorAction SilentlyContinue
    $close = 0
    if ($null -ne $response -and $null -ne $response.datas -and $response.datas.Count -gt 0) {
        $close = [int]($response.datas[0].closePriceRaw)
    } else {
        $close = 0
    }
    
    $evalVal = $close * $item.shares
    $weight = 0; if ($totalEval -gt 0) { $weight = [math]::Round(($evalVal / $totalEval) * 100, 1) }
    $targetAmt = ($totalEval + $cash) * ($item.target_weight / 100)
    $targetShares = 0; if ($close -gt 0) { $targetShares = $targetAmt / $close }
    $ttmDivTarget = $ttmDivDict[$item.ticker]
    if ($null -eq $ttmDivTarget) { $ttmDivTarget = 0 }
    $totalProjectedAnnualDiv += ($targetShares * $ttmDivTarget)
    $needAmt = $targetAmt - $evalVal
    if ($needAmt -gt 0) { $totalBuyAmt += $needAmt }
    elseif ($needAmt -lt 0) { $totalSellAmt += [math]::Abs($needAmt) }
    $achieve = 0; if ($targetAmt -gt 0) { $achieve = [math]::Round(($evalVal / $targetAmt) * 100, 0) }
    
    $template = $template -replace "\{\{WEIGHT_$($item.ticker)\}\}", "$weight%"
    $template = $template -replace "\{\{TARGET_AMT_$($item.ticker)\}\}", ("{0:N0}" -f $targetAmt)
    $template = $template -replace "\{\{ACHIEVE_$($item.ticker)\}\}", "$achieve%"
    
    $needStr = ""
    if ($needAmt -gt 0) { $needStr = "<span style='color:red;'>$("{0:N0}" -f $needAmt) 매수</span>" }
    elseif ($needAmt -lt 0) { $needStr = "<span style='color:blue;'>$("{0:N0}" -f [math]::Abs($needAmt)) 매도</span>" }
    else { $needStr = "완료" }
    $template = $template -replace "\{\{NEED_AMT_$($item.ticker)\}\}", "$needStr"

    # Action Plan Logic
    $nameLink = "<a href='https://finance.naver.com/item/main.naver?code=$($item.ticker)' target='_blank' style='text-decoration:none; color:inherit;'>$($item.name)</a>"
    if ($item.target_weight -eq 0 -and $item.shares -gt 0) {
        $sellValStr = "{0:N0}" -f $evalVal
        $step1 += "<li><span class='blue' style='color:blue;font-weight:bold;'>매도</span> $nameLink 전량 처분 (약 $sellValStr 원)</li>`n"
    } elseif ($needAmt -gt 0) {
        $needAmtStr = "{0:N0}" -f $needAmt
        $cat = $item.category
        if ($cat -eq "현금자산" -or $cat -eq "확정인컴") {
            $step2 += "<li><span class='red' style='color:red;font-weight:bold;'>매수</span> $($nameLink): 약 $needAmtStr 원 일괄 추가 매수</li>`n"
        } elseif ($cat -eq "성장자산" -or $cat -eq "변동인컴") {
            $splitAmt = [math]::Round($needAmt / 4, 0)
            $splitStr = "{0:N0}" -f $splitAmt
            $step3 += "<tr><td>$nameLink</td><td>$needAmtStr 원</td><td style='font-weight:bold;'>약 $splitStr 원씩 4회</td></tr>`n"
        } elseif ($cat -eq "파생인컴") {
            $step4 += "<li><span class='red' style='color:red;font-weight:bold;'>매수</span> $($nameLink): 약 $needAmtStr 원 추가 매수</li>`n"
        }
    }
}

$totalNeedStr = "<span style='color:red;'>매수: $("{0:N0}" -f $totalBuyAmt)</span> <span style='color:#ccc;'>|</span> <span style='color:blue;'>매도(활용): $("{0:N0}" -f $totalSellAmt)</span>"
$template = $template -replace '\{\{TOTAL_NEED_STR\}\}', $totalNeedStr

$today = (Get-Date).ToString("yyyy년 MM월 dd일")
$signHTMLTotal = "-"; $colorTotal = "black"
if ($totalChange -gt 0) { $signHTMLTotal = "&#9650;"; $colorTotal = "red" }
elseif ($totalChange -lt 0) { $signHTMLTotal = "&#9660;"; $colorTotal = "blue" }
$fTotalChange = "{0:N0}" -f [math]::Abs($totalChange)

$marketSum = "오늘($lastTradingDateStr)의 전체 포트폴리오 자산은 전일 대비 <strong style='color:$colorTotal;'>$signHTMLTotal $fTotalChange 원</strong> 변동되었습니다."
$template = $template -replace '\{\{MARKET_SUMMARY\}\}', $marketSum

# Replace Action Plan steps
if ([string]::IsNullOrWhiteSpace($step1)) { $step1 = "<li><span style='color:#7f8c8d;'>해당 종목 없음 (모든 위험 종목 처분 완료)</span></li>" }
if ([string]::IsNullOrWhiteSpace($step2)) { $step2 = "<li><span style='color:#7f8c8d;'>해당 종목 없음 (안전자산/확정인컴 목표 달성)</span></li>" }
if ([string]::IsNullOrWhiteSpace($step3)) { $step3 = "<tr><td colspan='3' style='text-align:center; color:#7f8c8d;'>해당 종목 없음 (성장/변동인컴 분할 매수 완료)</td></tr>" }
if ([string]::IsNullOrWhiteSpace($step4)) { $step4 = "<li><span style='color:#7f8c8d;'>해당 종목 없음 (파생인컴 비중 달성)</span></li>" }

$template = $template -replace '\{\{ACTION_PLAN_STEP1\}\}', $step1
$template = $template -replace '\{\{ACTION_PLAN_STEP2\}\}', $step2
$template = $template -replace '\{\{ACTION_PLAN_STEP3\}\}', $step3
$template = $template -replace '\{\{ACTION_PLAN_STEP4\}\}', $step4

$template = $template -replace '\{\{REPORT_DATE\}\}', $today
$template = $template -replace '\{\{TOTAL_INVESTMENT\}\}', ("{0:N0}" -f $totalInvest)
$template = $template -replace '\{\{TOTAL_ASSET_VALUE\}\}', ("{0:N0}" -f $totalEval)
$template = $template -replace '\{\{TOTAL_CHANGE_SIGN\}\}', "<span style='color:$colorTotal;'>$signHTMLTotal</span>"
$template = $template -replace '\{\{TOTAL_CHANGE_VALUE\}\}', "<span style='color:$colorTotal;'>$("{0:N0}" -f [math]::Abs($totalChange))</span>"
$template = $template -replace '\{\{CASH_BALANCE\}\}', ("{0:N0}" -f $cash)

$avgYield = 0; if ($totalEval -gt 0) { $avgYield = [math]::Round(($totalAnnualDiv / $totalEval) * 100, 2) }
$template = $template -replace '\{\{AVG_DIVIDEND_YIELD\}\}', "$avgYield"
$template = $template -replace '\{\{ANNUAL_DIVIDEND\}\}', ("{0:N0}" -f $totalAnnualDiv)
$template = $template -replace '\{\{MONTHLY_DIVIDEND\}\}', ("{0:N0}" -f ($totalAnnualDiv / 12))

$projectedAvgYield = 0; if (($totalEval + $cash) -gt 0) { $projectedAvgYield = [math]::Round(($totalProjectedAnnualDiv / ($totalEval + $cash)) * 100, 2) }
$template = $template -replace '\{\{PROJECTED_AVG_YIELD\}\}', "$projectedAvgYield"
$template = $template -replace '\{\{PROJECTED_ANNUAL_DIV\}\}', ("{0:N0}" -f $totalProjectedAnnualDiv)
$template = $template -replace '\{\{PROJECTED_MONTHLY_DIV\}\}', ("{0:N0}" -f ($totalProjectedAnnualDiv / 12))

$template = $template -replace '\{\{MARKET_SUMMARY\}\}', "당일 코스피/코스닥 마감 및 야후 파이낸스 배당 데이터를 반영했습니다."
$template = $template -replace '\{\{ACTION_PLAN_ITEMS\}\}', "<li>현재 자동으로 매수/매도 필요 금액을 표에서 확인하실 수 있습니다.</li>"

# Save HTML to preview file
$previewPath = Join-Path $scriptDir "..\resources\preview.html"
$enc = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($previewPath, $template, $enc)

# Save daily portfolio status to JSON Lines history file
$historyPath = Join-Path $scriptDir "..\portfolio_daily_log.jsonl"
$historyDate = (Get-Date).ToString("yyyy-MM-dd")
$logRecord = @{
    date = $historyDate
    summary = @{
        total_invest = $totalInvest
        total_eval = $totalEval
        cash_balance = $cash
    }
    holdings = $logHoldings
    prices = $logPrices
}
$logJson = $logRecord | ConvertTo-Json -Depth 5 -Compress

$updatedLines = @()
$dateFound = $false
if (Test-Path $historyPath) {
    $existingLines = [System.IO.File]::ReadAllLines($historyPath, $enc)
    foreach ($line in $existingLines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -match "`"date`":`"$historyDate`"") {
            $updatedLines += $logJson
            $dateFound = $true
        } else {
            $updatedLines += $line
        }
    }
}
if (-not $dateFound) {
    $updatedLines += $logJson
}
[System.IO.File]::WriteAllLines($historyPath, $updatedLines, $enc)

$smtp = New-Object System.Net.Mail.SmtpClient("smtp.gmail.com", 587)
$smtp.EnableSsl = $true
$smtp.Credentials = New-Object System.Net.NetworkCredential($sender, $password)

$msg = New-Object System.Net.Mail.MailMessage($sender, $receiver)
$dateStr = (Get-Date).ToString("yyyy-MM-dd")
    $msg.Subject = "[자동보고] IRP 포트폴리오 일일 마감 리포트 ($dateStr)"
$msg.IsBodyHtml = $true
$msg.Body = $template

try {
    $smtp.Send($msg)
    Write-Host "SUCCESS: Email sent successfully!"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

