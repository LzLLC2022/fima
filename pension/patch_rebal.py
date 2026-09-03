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

search = """        $rebalJson = @{
            owner = $targetOwner
            region = $targetRegion
        } | ConvertTo-Json -Depth 2"""

replace = """        $rebalJson = @{
            owner = $targetOwner
        } | ConvertTo-Json -Depth 2"""

patch_file("pension/scripts/daily_reporter.ps1", search, replace)
patch_file("pension/scripts/weekly_reporter.ps1", search, replace)
patch_file("pension/scripts/monthly_reporter.ps1", search, replace)
