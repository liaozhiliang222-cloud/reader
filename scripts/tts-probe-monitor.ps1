param(
    [int]$Minutes = 65,
    [Parameter(Mandatory = $true)][string]$Serial
)
$ErrorActionPreference = 'Stop'
$adb = 'D:\Android\Sdk\platform-tools\adb.exe'
$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root 'artifacts/tts-probe/lock-monitor.jsonl'
$until = [DateTimeOffset]::UtcNow.AddMinutes($Minutes)
while ([DateTimeOffset]::UtcNow -lt $until) {
    $checkpoint = & $adb -s $Serial shell run-as dev.jingye.ttsprobe cat files/checkpoint.json
    $checkpointExit = $LASTEXITCODE
    $power = & $adb -s $Serial shell dumpsys power |
        Select-String 'mWakefulness=|mLastWakeTime=|mLastSleepTime=|mLastSleepReason='
    $network = & $adb -s $Serial shell dumpsys connectivity |
        Select-String 'Active default network'
    [ordered]@{
        observedAt = [DateTimeOffset]::Now.ToString('o')
        checkpointExit = $checkpointExit
        checkpoint = ($checkpoint -join "`n")
        power = @($power | ForEach-Object { $_.Line.Trim() })
        network = @($network | ForEach-Object { $_.Line.Trim() })
    } | ConvertTo-Json -Compress | Add-Content -LiteralPath $output -Encoding utf8
    Start-Sleep -Seconds 30
}
