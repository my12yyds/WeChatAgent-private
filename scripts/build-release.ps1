param(
  [Parameter(Mandatory=$true)][string]$PayloadRoot,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$Version = '0.5.1',
  [switch]$Resume
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$payload = (Resolve-Path -LiteralPath $PayloadRoot).Path.TrimEnd('\')
$out = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $out)) { New-Item -ItemType Directory -Path $out | Out-Null }
$out = (Resolve-Path -LiteralPath $out).Path
if ($out.StartsWith($payload + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputDirectory must be outside PayloadRoot.' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must use major.minor.patch format.' }

$exe = Join-Path $payload 'app/WeChatGirl.exe'
$oldExe = Join-Path $payload 'app/WeChatAgent.exe'
if (-not (Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $oldExe)) {
  Copy-Item -LiteralPath $oldExe -Destination $exe
  if ((Get-FileHash -LiteralPath $oldExe).Hash -ne (Get-FileHash -LiteralPath $exe).Hash) { throw 'Brand executable copy did not verify.' }
  [IO.File]::Delete($oldExe)
}
if (-not (Test-Path -LiteralPath $exe)) { throw 'Payload is missing app/WeChatGirl.exe.' }
if (-not (Test-Path -LiteralPath (Join-Path $payload 'app/resources/project/public/console/index.html'))) { throw 'Payload is missing the application workspace.' }
if (-not (Test-Path -LiteralPath (Join-Path $payload 'app/resources/app/main.cjs'))) { throw 'Payload is missing the Electron desktop shell.' }

$portableName = "WeChatGirl-$Version-portable-x64.zip"
$setupName = "WeChatGirl-Setup-$Version-x64.exe"
$voiceName = 'WeChatGirl-voice-components.zip'
$portablePath = Join-Path $out $portableName
$setupPath = Join-Path $out $setupName
$voicePath = Join-Path $out $voiceName
if (!$Resume) { foreach ($file in @($portablePath,$setupPath,$voicePath)) { if (Test-Path -LiteralPath $file) { throw "Release output already exists: $file" } } }
if ($Resume) { foreach ($file in @($portablePath,$setupPath,$voicePath,(Join-Path $out 'SHA256SUMS.txt'),(Join-Path $out 'VERIFICATION.json'))) { if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) } } }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$files = Get-ChildItem -LiteralPath $payload -File -Recurse | Where-Object {
  $rel = $_.FullName.Substring($payload.Length + 1).Replace('\','/')
  $rel -notmatch '(^|/)\.git(/|$)|(^|/)__pycache__(/|$)|(^|/)(?:\.temp|Cache)(/|$)|\.pyc$|^data/\.wechatagent-data\.json$|(^|/)data/workspace/state(/|$)|(^|/)data/workspace/plugins(/|$)|(^|/)data/desktop/(?:runtime\.json|session)(?:/|$)|\.lock$' -and
    $rel -notmatch '^data/voice-(?:python|wsl)(?:/|$)' -and
    ($rel -notmatch '^app/locales/[^/]+\.pak$' -or $rel -match '^app/locales/(?:en-US|zh-CN)\.pak$')
}
if (-not $files.Count) { throw 'No payload files remain after release exclusions.' }

$manifest = Get-Content -LiteralPath (Join-Path $payload 'app/resources/project/deployment.json') -Raw | ConvertFrom-Json
$desktopVersion = (Get-Content -LiteralPath (Join-Path $payload 'app/resources/app/package.json') -Raw | ConvertFrom-Json).version
if ($manifest.version -ne $Version -or $manifest.packageVersion -ne $Version -or $desktopVersion -ne $Version) { throw 'Payload versions do not match the requested release.' }
foreach ($file in $files) {
  $relative = $file.FullName.Substring($payload.Length + 1).Replace('\','/')
  if ($relative -match '(?:^|/)(?:\.env|storage\.ini|plugins\.json|distribution\.json)$|\.(?:token|log|db|sqlite|pem|key|pfx|tmp)$|^app/resources/project/(?:state|plugins)/|^app/resources/project/config/(?!wechatagent\.example\.json$)') {
    throw "Private or temporary file in payload: $relative"
  }
}

if (!(Test-Path -LiteralPath $portablePath)) {
  $portable = [IO.Compression.ZipFile]::Open($portablePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $entry = $file.FullName.Substring($payload.Length + 1).Replace('\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($portable, $file.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $portable.Dispose() }
}

$voiceRoots = @('data/voice-python','data/voice-wsl') | ForEach-Object { Join-Path $payload $_.Replace('/','\') } | Where-Object { Test-Path -LiteralPath $_ }
if ($voiceRoots.Count -and !(Test-Path -LiteralPath $voicePath)) {
  $voice = [IO.Compression.ZipFile]::Open($voicePath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($root in $voiceRoots) {
      Get-ChildItem -LiteralPath $root -File -Recurse | ForEach-Object {
        if ($_.Name -in @('.lock','.gitignore') -or $_.FullName -match '[\\/](?:\.git|\.temp|__pycache__|Cache)(?:[\\/]|$)' -or $_.Extension -eq '.pyc') { return }
        $entry = $_.FullName.Substring($payload.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($voice, $_.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
      }
    }
    $readme = "WeChatGirl optional voice environments`r`n`r`nExtract beside app and data. These environments do not include every required model or reference audio. See docs/VOICE_STUDIO.md before enabling synthesis. No user state is included.`r`n"
    $entry = $voice.CreateEntry('VOICE-OPTIONAL-README.txt')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($readme) } finally { $writer.Dispose() }
  } finally { $voice.Dispose() }
}

$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET/Framework/v4.0.30319/csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'C# compiler not found; install the .NET Framework developer tools.' }
$installerSource = Join-Path $repo 'packaging/windows/Installer.cs'
$uninstallSource = Join-Path $repo 'packaging/windows/Uninstall.cs'
$assemblyInfo = Join-Path $repo 'packaging/windows/AssemblyInfo.cs'
$icon = Join-Path $repo 'desktop/icon.ico'
$uninstaller = Join-Path $out 'uninstall-build.exe'
$stub = Join-Path $out 'installer-stub.exe'
& $csc /nologo /target:exe /out:$uninstaller /win32icon:$icon $uninstallSource
if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed.' }
& $csc /nologo /target:exe /out:$stub /win32icon:$icon /resource:"$uninstaller,Uninstall.exe" /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll $installerSource $assemblyInfo
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }

$footer = $null
if ($Resume -and (Test-Path -LiteralPath $setupPath)) { [IO.File]::Delete($setupPath) }
$installerStream = [IO.File]::Open($setupPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
  $stubBytes = [IO.File]::ReadAllBytes($stub)
  $installerStream.Write($stubBytes,0,$stubBytes.Length)
  $zipStream = [IO.File]::OpenRead($portablePath)
  try { $zipStream.CopyTo($installerStream,1048576); $zipLength = $zipStream.Length } finally { $zipStream.Dispose() }
  $footer = [System.BitConverter]::GetBytes([Int64]$zipLength) + [Text.Encoding]::ASCII.GetBytes('WXSFX001')
  $installerStream.Write($footer,0,$footer.Length)
} finally { $installerStream.Dispose() }

[IO.File]::Delete($uninstaller)
[IO.File]::Delete($stub)
$sums = @($portableName,$setupName) + $(if (Test-Path -LiteralPath $voicePath) { @($voiceName) } else { @() })
$sums | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $out $_) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_ } | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
[pscustomobject]@{
  version = $Version
  buildId = $manifest.buildId
  builtAt = $manifest.builtAt
  Portable = $portableName
  Setup = $setupName
  OptionalVoice = if (Test-Path -LiteralPath $voicePath) { $voiceName } else { $null }
  PayloadFiles = $files.Count
  OptionalLanguages = 'en-US, zh-CN'
  Excludes = 'voice runtime, user state, user plugins, transient caches'
} | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $out 'VERIFICATION.json') -Encoding utf8
Get-ChildItem -LiteralPath $out -File | Select-Object Name,Length
