param(
    [Parameter(Mandatory = $true)][string]$Text,
    [string]$Adb = 'D:\Android\Sdk\platform-tools\adb.exe'
)
$ErrorActionPreference = 'Stop'
# Interact only with an exact, visible button in our independent probe.
& $Adb shell uiautomator dump /data/local/tmp/jingye-tts-ui.xml | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect device UI' }
[xml]$probeUi = (& $Adb shell cat /data/local/tmp/jingye-tts-ui.xml) -join "`n"
$probeButton = $probeUi.SelectNodes('//node') | Where-Object {
    $_.package -eq 'dev.jingye.ttsprobe' -and $_.text -eq $Text -and $_.clickable -eq 'true'
} | Select-Object -First 1
if (-not $probeButton) { throw "Visible probe control not found: $Text" }
if ($probeButton.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw 'Invalid bounds' }
$probeX = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
$probeY = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
& $Adb shell input tap $probeX $probeY
if ($LASTEXITCODE -ne 0) { throw 'Device input failed' }
