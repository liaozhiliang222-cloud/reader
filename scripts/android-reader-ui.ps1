param(
    [string]$Text,
    [string]$Description,
    [switch]$Inspect,
    [string]$Package = 'dev.jingye.reader',
    [string]$Adb = 'D:\Android\Sdk\platform-tools\adb.exe'
)
$ErrorActionPreference = 'Stop'
& $Adb shell uiautomator dump /data/local/tmp/jingye-reader-ui.xml | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Android UI' }
[xml]$readerUi = (& $Adb shell cat /data/local/tmp/jingye-reader-ui.xml) -join "`n"
$nodes = @($readerUi.SelectNodes('//node') | Where-Object { $_.package -eq $Package })
if ($Inspect) {
    $nodes | Where-Object { $_.text -ne '' -or $_.'content-desc' -ne '' } |
        Select-Object text,'content-desc',class,clickable,bounds | Format-List
    return
}
$button = $nodes | Where-Object {
    $_.clickable -eq 'true' -and $_.enabled -eq 'true' -and
    (($Text -and $_.text -eq $Text) -or ($Description -and $_.'content-desc' -eq $Description)) -and
    $_.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$' -and [int]$Matches[4] -gt [int]$Matches[2]
} | Select-Object -First 1
if (-not $button) { throw 'Exact visible reader control not found' }
$null = $button.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'
$readerX = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
$readerY = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
Write-Output ("UI: {0} @ {1},{2}" -f $button.text, $readerX, $readerY)
& $Adb shell input tap $readerX $readerY
if ($LASTEXITCODE -ne 0) { throw 'Android input failed' }
