param(
  [DateTimeOffset]$CheckedAfter = ([DateTimeOffset]::UtcNow.AddMinutes(-30))
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$bookRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'test-books'))

function Assert-ChildPath([string]$Path, [string]$Root) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the expected directory: $resolved"
  }
  return $resolved
}

$runRoot = Assert-ChildPath (Join-Path $bookRoot ('backup-desktop/' + [Guid]::NewGuid().ToString())) $bookRoot
$results = @()
foreach ($engine in @('Pixel-7', 'iPhone-14')) {
  $reportPath = Join-Path $workspace "artifacts/backup-export-browser/$engine.json"
  $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $browserCheckedAt = [DateTimeOffset]$report.checkedAt
  if ($browserCheckedAt -lt $CheckedAfter) { throw "Stale browser report: $engine" }
  if ($report.engine -ne $engine -or -not $report.nativeDownload -or -not $report.originalsEqual -or -not $report.workerPreviewOnlyMetadata -or -not $report.preparedRepliesEachSingleBook -or -not $report.exportInputOnlyMetadata -or -not $report.sourceReadsAfterWorkerStart) {
    throw "Browser download was not verified: $engine"
  }
  if ($report.sourceBytes -le 1048576 -or $report.files.Count -ne 13) { throw "Unexpected fixture: $engine" }
  $zipPath = Assert-ChildPath $report.zipPath $bookRoot
  $zipFile = Get-Item -LiteralPath $zipPath
  $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipFile.Length -ne $report.zipBytes -or $zipHash -ne $report.zipSha256) {
    throw "Downloaded archive changed: $engine"
  }
  $destination = Assert-ChildPath (Join-Path $runRoot $engine) $bookRoot
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    $expectedNames = @('backup.json') + @($report.files | ForEach-Object { $_.path })
    if ($names.Count -ne 14 -or (@($names | Select-Object -Unique)).Count -ne 14) {
      throw "Unexpected archive entries: $engine"
    }
    foreach ($name in $names) {
      if ($name -match '(^/|\\|:|(^|/)\.\.?(/|$)|[\x00-\x1f])' -or $name.EndsWith('/') -or $name -notin $expectedNames) {
        throw "Unsafe or unexpected archive entry: $name"
      }
      $null = Assert-ChildPath (Join-Path $destination $name) $destination
    }
  } finally {
    $archive.Dispose()
  }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $destination
  $files = @()
  foreach ($expected in $report.files) {
    $path = Assert-ChildPath (Join-Path $destination $expected.path) $destination
    $actual = Get-Item -LiteralPath $path
    $sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual.Length -ne $expected.size -or $sha256 -ne $expected.sha256) {
      throw "Extracted original differs: $engine/$($expected.path)"
    }
    $files += [ordered]@{ path = $expected.path; size = $actual.Length; sha256 = $sha256 }
  }
  $metadata = Get-Content -LiteralPath (Join-Path $destination 'backup.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($metadata.app -ne 'jingye' -or $metadata.kind -ne 'full' -or $metadata.books.Count -ne 13) {
    throw "Unexpected extracted metadata: $engine"
  }
  $results += [ordered]@{
    engine = $engine
    browserCheckedAt = $browserCheckedAt.ToUniversalTime().ToString('o')
    zipPath = $zipPath
    zipBytes = $zipFile.Length
    zipSha256 = $zipHash
    destination = $destination
    files = $files
    passed = $true
  }
}
$result = [ordered]@{
  checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
  extractor = 'Windows PowerShell Expand-Archive / System.IO.Compression'
  physicalDeviceOrPeakRamAcceptance = $false
  results = $results
}
$json = $result | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText((Join-Path $workspace 'artifacts/backup-desktop-extraction.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output 'Both browser downloads extracted successfully; all 26 originals match their expected SHA256 and size.'
