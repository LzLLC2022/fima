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

search_m = """$today = (Get-Date).ToString("yyyy년 MM월 dd일")
$template = $template -replace '\\{\\{REPORT_DATE\\}\\}', $today"""
replace_m = """$baseDateStr = (Get-Date).AddMonths(-1).ToString("yyyy년 MM월 말일")
$template = $template -replace '\\{\\{REPORT_DATE\\}\\}', "$baseDateStr (전월 기준)"
$today = (Get-Date).ToString("yyyy-MM-dd")"""
patch_file("pension/scripts/monthly_reporter.ps1", search_m, replace_m)

search_w = """$today = (Get-Date).ToString("yyyy년 MM월 dd일")
$template = $template -replace '\\{\\{REPORT_DATE\\}\\}', $today"""
replace_w = """$baseDateStr = (Get-Date)
while ($baseDateStr.DayOfWeek -ne 'Friday') { $baseDateStr = $baseDateStr.AddDays(-1) }
$baseDateFmt = $baseDateStr.ToString("yyyy년 MM월 dd일")
$template = $template -replace '\\{\\{REPORT_DATE\\}\\}', "$baseDateFmt (금요일 기준)"
$today = (Get-Date).ToString("yyyy-MM-dd")"""
patch_file("pension/scripts/weekly_reporter.ps1", search_w, replace_w)
