import os

def patch_monthly():
    with open('pension/scripts/monthly_reporter.ps1', 'r', encoding='utf-8') as f:
        content = f.read()

    search = '''        # Fetch Price from Naver Polling API (Supports ETN/Fund codes like 0018C0)
        $url = "https://polling.finance.naver.com/api/realtime/domestic/stock/$($item.ticker)"
        $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "Mozilla/5.0" } -ErrorAction SilentlyContinue
        
        $close = 0
        $compare = 0
        if ($null -ne $response -and $null -ne $response.datas -and $response.datas.Count -gt 0) {
            $data = $response.datas[0]
            $close = [int]($data.closePriceRaw)
            $compare = [int]($data.compareToPreviousClosePriceRaw)
            $tDate = $data.localTradedAt
            if ($null -ne $tDate -and [string]::IsNullOrEmpty($lastTradingDateStr) -and $tDate.Length -ge 10) {
                $lastTradingDateStr = $tDate.Substring(5, 2) + "월 " + $tDate.Substring(8, 2) + "일"
            }
        } else {
            # Fallback if Naver fails
            $close = $item.avg_price
            $compare = 0
        }'''

    replace = '''        $prevMonthStr = (Get-Date).AddMonths(-1).ToString('yyyyMM')
        $prevPrevMonthStr = (Get-Date).AddMonths(-2).ToString('yyyyMM')
        try {
            $closeStr = python (Join-Path $scriptDir "fetch_month_end.py") $($item.ticker) $prevMonthStr
            $lastCloseStr = python (Join-Path $scriptDir "fetch_month_end.py") $($item.ticker) $prevPrevMonthStr
            if ($closeStr -is [array]) { $closeStr = $closeStr[-1] }
            if ($lastCloseStr -is [array]) { $lastCloseStr = $lastCloseStr[-1] }
            $close = [int]$closeStr
            $lastClose = [int]$lastCloseStr
            if ($close -lt 0) { $close = 0 }
            if ($close -gt 0 -and $lastClose -gt 0) {
                $compare = $close - $lastClose
            } else {
                $compare = 0
            }
        } catch {
            $close = 0
            if ($null -ne $item.avg_price) { $close = $item.avg_price }
            $compare = 0
        }'''

    if search in content:
        content = content.replace(search, replace)
        print("Patched Naver API block in monthly_reporter.ps1")
    else:
        print("Could not find Naver API block in monthly_reporter.ps1")

    # Now replace the old redundant python fetch if it exists
    # Wait, the redundant python fetch is in weekly_reporter, not monthly_reporter
    # Wait, let's just replace the REPORT_DATE template
    
    search3 = '''$today = (Get-Date).ToString("yyyy년 MM월 dd일")
$template = $template -replace '\{\{REPORT_DATE\}\}', $today'''
    
    replace3 = '''$baseDateStr = (Get-Date).AddMonths(-1).ToString("yyyy년 MM월 말일")
$template = $template -replace '\{\{REPORT_DATE\}\}', "$baseDateStr (전월 기준)"'''
    if search3 in content:
        content = content.replace(search3, replace3)
        print("Patched REPORT_DATE in monthly_reporter.ps1")
    else:
        print("Could not find REPORT_DATE block in monthly_reporter.ps1")

    with open('pension/scripts/monthly_reporter.ps1', 'w', encoding='utf-8') as f:
        f.write("\ufeff" + content)


def patch_weekly():
    with open('pension/scripts/weekly_reporter.ps1', 'r', encoding='utf-8') as f:
        content = f.read()

    search = '''        # Fetch Price from Naver Polling API (Supports ETN/Fund codes like 0018C0)
        $url = "https://polling.finance.naver.com/api/realtime/domestic/stock/$($item.ticker)"
        $response = Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "Mozilla/5.0" } -ErrorAction SilentlyContinue
        
        $close = 0
        $compare = 0
        if ($null -ne $response -and $null -ne $response.datas -and $response.datas.Count -gt 0) {
            $data = $response.datas[0]
            $close = [int]($data.closePriceRaw)
            $compare = [int]($data.compareToPreviousClosePriceRaw)
            $tDate = $data.localTradedAt
            if ($null -ne $tDate -and [string]::IsNullOrEmpty($lastTradingDateStr) -and $tDate.Length -ge 10) {
                $lastTradingDateStr = $tDate.Substring(5, 2) + "월 " + $tDate.Substring(8, 2) + "일"
            }
        } else {
            # Fallback if Naver fails
            $close = $item.avg_price
            $compare = 0
        }'''

    replace = '''        $baseDate = (Get-Date)
        while ($baseDate.DayOfWeek -ne 'Friday') { $baseDate = $baseDate.AddDays(-1) }
        $compDate = $baseDate.AddDays(-7)
        
        $baseStart = $baseDate.AddDays(-3).ToString('yyyyMMdd')
        $baseEnd = $baseDate.ToString('yyyyMMdd')
        $compStart = $compDate.AddDays(-3).ToString('yyyyMMdd')
        $compEnd = $compDate.ToString('yyyyMMdd')
        
        try {
            $closeStr = python (Join-Path $scriptDir "fetch_latest_close.py") $($item.ticker) $baseStart $baseEnd
            $lastCloseStr = python (Join-Path $scriptDir "fetch_latest_close.py") $($item.ticker) $compStart $compEnd
            if ($closeStr -is [array]) { $closeStr = $closeStr[-1] }
            if ($lastCloseStr -is [array]) { $lastCloseStr = $lastCloseStr[-1] }
            $close = [int]$closeStr
            $lastClose = [int]$lastCloseStr
            if ($close -lt 0) { $close = 0 }
            if ($close -gt 0 -and $lastClose -gt 0) {
                $compare = $close - $lastClose
            } else {
                $compare = 0
            }
        } catch {
            $close = 0
            if ($null -ne $item.avg_price) { $close = $item.avg_price }
            $compare = 0
        }'''
        
    if search in content:
        content = content.replace(search, replace)
        print("Patched Naver API block in weekly_reporter.ps1")
    else:
        print("Could not find Naver API block in weekly_reporter.ps1")
        
    # Also in weekly_reporter, there's a redundant fetch_hist.py block we must delete!
    search2 = '''        $startTime = (Get-Date).AddDays(-8).ToString('yyyyMMdd')
        $endTime = (Get-Date).ToString('yyyyMMdd')
        try {
            $pyScriptPath = Join-Path $scriptDir "fetch_hist.py"
            $lastClose = python $pyScriptPath $($item.ticker) $startTime $endTime
            $lastClose = [int]$lastClose
            if ($lastClose -gt 0) { $compare = $close - $lastClose }
            else { $compare = 0 }
        } catch { $compare = 0 }'''
    if search2 in content:
        content = content.replace(search2, "")
        print("Patched redundant fetch_hist block in weekly_reporter.ps1")
    else:
        print("Could not find redundant fetch_hist block in weekly_reporter.ps1")

    search3 = '''$today = (Get-Date).ToString("yyyy년 MM월 dd일")
$template = $template -replace '\{\{REPORT_DATE\}\}', $today'''
    
    replace3 = '''$baseDateStr = (Get-Date)
while ($baseDateStr.DayOfWeek -ne 'Friday') { $baseDateStr = $baseDateStr.AddDays(-1) }
$baseDateFmt = $baseDateStr.ToString("yyyy년 MM월 dd일")
$template = $template -replace '\{\{REPORT_DATE\}\}', "$baseDateFmt (금요일 기준)"'''
    if search3 in content:
        content = content.replace(search3, replace3)
        print("Patched REPORT_DATE in weekly_reporter.ps1")
    else:
        print("Could not find REPORT_DATE block in weekly_reporter.ps1")

    with open('pension/scripts/weekly_reporter.ps1', 'w', encoding='utf-8') as f:
        f.write("\ufeff" + content)

patch_monthly()
patch_weekly()
