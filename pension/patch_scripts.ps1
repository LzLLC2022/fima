$scriptPath = "d:\Repos\fima\pension\scripts\monthly_reporter.ps1"
$content = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)

$search = '(?ms)        # Fetch Price from Naver Polling API.*?\} else \{\s*# Fallback if Naver fails\s*\$close = \$item\.avg_price\s*\$compare = 0\s*\}'
$replace = @'
        $prevMonthStr = (Get-Date).AddMonths(-1).ToString('yyyyMM')
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
        }
'@
$content = [regex]::Replace($content, $search, $replace)

$search2 = '(?ms)        \$prevMonthStr = \(Get-Date\)\.AddMonths\(-1\)\.ToString\(''yyyyMM''\).*?\} catch \{\}.*?\$prevClose = \$close - \$compare'
$replace2 = '        $prevClose = $close - $compare'
$content = [regex]::Replace($content, $search2, $replace2)

$search3 = '\$today = \(Get-Date\)\.ToString\("yyyy년 MM월 dd일"\)\s*\$template = \$template -replace ''\\\{\\\{REPORT_DATE\\\}\\}'', \$today'
$replace3 = '$baseDateStr = (Get-Date).AddMonths(-1).ToString("yyyy년 MM월 말일")
$template = $template -replace ''\{\{REPORT_DATE\}\}'', "$baseDateStr (전월 기준)"'
$content = [regex]::Replace($content, $search3, $replace3)

$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($scriptPath, $content, $utf8Bom)

# Weekly Reporter
$scriptPath = "d:\Repos\fima\pension\scripts\weekly_reporter.ps1"
$content = [System.IO.File]::ReadAllText($scriptPath, [System.Text.Encoding]::UTF8)

$search = '(?ms)        # Fetch Price from Naver Polling API.*?\} else \{\s*# Fallback if Naver fails\s*\$close = \$item\.avg_price\s*\$compare = 0\s*\}'
$replace = @'
        $baseDate = (Get-Date)
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
        }
'@
$content = [regex]::Replace($content, $search, $replace)

$search2 = '(?ms)        \$startTime = \(Get-Date\)\.AddDays\(-8\)\.ToString\(''yyyyMMdd''\).*?\} catch \{ \$compare = 0 \}'
$replace2 = ''
$content = [regex]::Replace($content, $search2, $replace2)

$search3 = '\$today = \(Get-Date\)\.ToString\("yyyy년 MM월 dd일"\)\s*\$template = \$template -replace ''\\\{\\\{REPORT_DATE\\\}\\}'', \$today'
$replace3 = '$baseDateStr = (Get-Date)
while ($baseDateStr.DayOfWeek -ne ''Friday'') { $baseDateStr = $baseDateStr.AddDays(-1) }
$baseDateFmt = $baseDateStr.ToString("yyyy년 MM월 dd일")
$template = $template -replace ''\{\{REPORT_DATE\}\}'', "$baseDateFmt (금요일 기준)"'
$content = [regex]::Replace($content, $search3, $replace3)

[System.IO.File]::WriteAllText($scriptPath, $content, $utf8Bom)

Write-Host "Replacement Done."
