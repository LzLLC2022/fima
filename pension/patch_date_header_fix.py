import os

def patch_file(filepath, search, replace):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    if search in content:
        content = content.replace(search, replace)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("\ufeff" + content)
        print(f"Patched {filepath}")
    else:
        print(f"Not found in {filepath}")


# Daily
search_d = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전일'
$compDate = (Get-Date).AddDays(-1)
while ($compDate.DayOfWeek -eq 'Saturday' -or $compDate.DayOfWeek -eq 'Sunday') { $compDate = $compDate.AddDays(-1) }
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
replace_d = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전일'
$baseDateStr = (Get-Date).ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $baseDateStr"""
patch_file("pension/scripts/daily_reporter.ps1", search_d, replace_d)

# Weekly
search_w = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전주'
$compDate = (Get-Date).AddDays(-7)
while ($compDate.DayOfWeek -ne 'Friday') { $compDate = $compDate.AddDays(-1) }
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
replace_w = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전주'
$baseDate = (Get-Date)
while ($baseDate.DayOfWeek -ne 'Friday') { $baseDate = $baseDate.AddDays(-1) }
$baseDateStr = $baseDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $baseDateStr"""
patch_file("pension/scripts/weekly_reporter.ps1", search_w, replace_w)

# Monthly
search_m = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전월'
$compDate = (Get-Date).AddMonths(-1)
$compDate = $compDate.AddDays(-$compDate.Day)
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
replace_m = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전월'
$baseDate = (Get-Date)
$baseDate = $baseDate.AddDays(-$baseDate.Day)
$baseDateStr = $baseDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $baseDateStr"""
patch_file("pension/scripts/monthly_reporter.ps1", search_m, replace_m)
