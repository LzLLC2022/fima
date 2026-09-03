$d = (Get-Date).AddMonths(-1)
$d = $d.AddDays(-$d.Day)
Write-Host $d.ToString('MM월 dd일')
