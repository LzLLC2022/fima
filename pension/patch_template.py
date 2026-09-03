import os

filepath = "pension/resources/report_template.html"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

search = '<th>{{COMPARE_LABEL}} 대비</th>'
replace = '<th>{{COMPARE_LABEL}} 대비<br><span style="font-size:11px; font-weight:normal; color:#7f8c8d;">({{COMPARE_DATE}} 기준)</span></th>'

if search in content:
    content = content.replace(search, replace)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("\ufeff" + content)
    print(f"Patched {filepath}")
else:
    print("Not found")
