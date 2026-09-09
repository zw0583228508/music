# Read-only inventory scan of the owner's drive D: (PR-96, owner-drive-inventory).
# Lists names, sizes and dates only (Get-ChildItem -Recurse -File). Never extracts, installs, copies or opens anything.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scan-owner-drive.ps1 -OutDir <dir>   (file must stay UTF-8 with BOM: the root name is Hebrew)
param([Parameter(Mandatory = $true)][string]$OutDir)
$ErrorActionPreference = 'SilentlyContinue'
$root = 'D:\פלאגינים'
$out = Join-Path $OutDir 'folders'
New-Item -ItemType Directory -Force $out | Out-Null
$log = Join-Path $out '..\scan.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Rel($full, $base) { if ($full.Length -gt $base.Length) { $full.Substring($base.Length + 1) } else { '' } }

# root loose files (not opened)
$rootFiles = Get-ChildItem -LiteralPath 'D:\' -File -Force | ForEach-Object { [pscustomobject]@{ name = $_.Name; bytes = $_.Length; lastWrite = $_.LastWriteTimeUtc.ToString('o'); attributes = $_.Attributes.ToString() } }
[System.IO.File]::WriteAllText((Join-Path $out '..\root-files.json'), ($rootFiles | ConvertTo-Json -Depth 3), $utf8)

$folders = @(Get-ChildItem -LiteralPath $root -Directory -Force | Sort-Object Name)
$extraRoot = @(Get-ChildItem -LiteralPath 'D:\' -Directory -Force | Where-Object { $_.Name -notin @('$RECYCLE.BIN', 'System Volume Information') -and $_.FullName -ne $root })
$folders = @($folders) + @($extraRoot)
Add-Content -LiteralPath $log -Value ("START {0} folders under root + {1} extra root folders at {2}" -f ($folders.Count - $extraRoot.Count), $extraRoot.Count, (Get-Date -Format o)) -Encoding UTF8
$i = 0
foreach ($f in $folders) {
  $i++
  $safe = ('{0:D3}' -f $i)
  $target = Join-Path $out "$safe.json"
  if (Test-Path $target) { continue }
  $t0 = Get-Date
  $base = $f.FullName
  $files = @(Get-ChildItem -LiteralPath $base -Recurse -File -Force)
  $size = 0; foreach ($x in $files) { $size += $x.Length }
  $ext = @($files | Group-Object { $_.Extension.ToLowerInvariant() } | ForEach-Object {
      $b = 0; foreach ($x in $_.Group) { $b += $x.Length }
      [pscustomobject]@{ ext = $_.Name; count = $_.Count; bytes = $b }
    } | Sort-Object bytes -Descending)
  $top = @(Get-ChildItem -LiteralPath $base -Force | ForEach-Object {
      if ($_.PSIsContainer) { [pscustomobject]@{ name = $_.Name; isDir = $true; bytes = $null } }
      else { [pscustomobject]@{ name = $_.Name; isDir = $false; bytes = $_.Length } }
    })
  $sub2 = @(Get-ChildItem -LiteralPath $base -Directory -Recurse -Depth 1 -Force | ForEach-Object { Rel $_.FullName $base } | Select-Object -First 400)
  $archives = @($files | Where-Object { $_.Name -match '(?i)\.(rar|zip|7z|r\d\d|z\d\d|\d\d\d)$' } | ForEach-Object { [pscustomobject]@{ rel = (Rel $_.FullName $base); bytes = $_.Length } })
  $suspicious = @($files | Where-Object { $_.Name -match '(?i)keygen|crack|patch|activat|r2r|\.exe$|\.dll$|\.bat$|\.cmd$|\.msi$|\.reg$' } | Select-Object -First 300 | ForEach-Object { Rel $_.FullName $base })
  $docs = @($files | Where-Object { $_.Name -match '(?i)readme|licen|eula|manual|\.pdf$|\.txt$|\.nfo$|\.rtf$|\.html?$' } | Select-Object -First 200 | ForEach-Object { Rel $_.FullName $base })
  $sample = @($files | Select-Object -First 80 | ForEach-Object { Rel $_.FullName $base })
  $largest = @($files | Sort-Object Length -Descending | Select-Object -First 15 | ForEach-Object { [pscustomobject]@{ rel = (Rel $_.FullName $base); bytes = $_.Length } })
  $dates = $files | Measure-Object -Property LastWriteTimeUtc -Minimum -Maximum
  $wavs = @($files | Where-Object { $_.Extension -match '(?i)^\.(wav|aif|aiff|flac)$' })
  $wavSample = @($wavs | Get-Random -Count ([Math]::Min(40, $wavs.Count)) | ForEach-Object { Rel $_.FullName $base })
  $wavDirs = @($wavs | ForEach-Object { Split-Path (Rel $_.FullName $base) -Parent } | Group-Object | Sort-Object Count -Descending | Select-Object -First 40 | ForEach-Object { [pscustomobject]@{ dir = $_.Name; count = $_.Count } })
  $obj = [ordered]@{
    index = $i; name = $f.Name; path = $base; files = $files.Count; bytes = $size
    oldest = $(if ($dates.Minimum) { $dates.Minimum.ToString('o') } else { $null })
    newest = $(if ($dates.Maximum) { $dates.Maximum.ToString('o') } else { $null })
    extensions = $ext; topLevel = $top; subDirsDepth2 = $sub2; archives = $archives
    suspiciousNamesNotOpened = $suspicious; docs = $docs; sampleFiles = $sample; largest = $largest
    wavCount = $wavs.Count; wavSample = $wavSample; wavDirs = $wavDirs
    scanSeconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  }
  [System.IO.File]::WriteAllText($target, ($obj | ConvertTo-Json -Depth 6), $utf8)
  Add-Content -LiteralPath $log -Value ("{0} {1} files={2} bytes={3} sec={4}" -f $safe, $f.Name, $files.Count, $size, $obj.scanSeconds) -Encoding UTF8
}
Add-Content -LiteralPath $log -Value 'DONE' -Encoding UTF8
