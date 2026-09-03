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

# Template
search_t = '<th style="padding:15px; border-bottom:2px solid #e0e0e0; background-color:#f9f9f9;">{{COMPARE_LABEL}} 대비</th>'
replace_t = '<th style="padding:15px; border-bottom:2px solid #e0e0e0; background-color:#f9f9f9; line-height:1.3;">{{COMPARE_LABEL}} 대비<br><span style="font-size:11px; font-weight:normal; color:#7f8c8d;">({{COMPARE_DATE}} 기준)</span></th>'
patch_file("pension/resources/report_template.html", search_t, replace_t)

# Daily
search_d = "$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전일'"
replace_d = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전일'
$compDate = (Get-Date).AddDays(-1)
while ($compDate.DayOfWeek -eq 'Saturday' -or $compDate.DayOfWeek -eq 'Sunday') { $compDate = $compDate.AddDays(-1) }
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
patch_file("pension/scripts/daily_reporter.ps1", search_d, replace_d)

# Weekly
search_w = "$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전주'"
replace_w = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전주'
$compDate = (Get-Date).AddDays(-7)
while ($compDate.DayOfWeek -ne 'Friday') { $compDate = $compDate.AddDays(-1) }
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
patch_file("pension/scripts/weekly_reporter.ps1", search_w, replace_w)

# Monthly
search_m = "$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전월'"
replace_m = """$template = $template -replace '\\{\\{COMPARE_LABEL\\}\\}', '전월'
$compDate = (Get-Date).AddMonths(-1)
$compDate = $compDate.AddDays(-$compDate.Day)
$compDateStr = $compDate.ToString("MM월 dd일")
$template = $template -replace '\\{\\{COMPARE_DATE\\}\\}', $compDateStr"""
patch_file("pension/scripts/monthly_reporter.ps1", search_m, replace_m)
