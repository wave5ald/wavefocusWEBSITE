<#
.SYNOPSIS
  Publishes a Wave Focus release manifest (updates/version.json).

.DESCRIPTION
  1. Upload the installers to GitHub Releases:
       - Windows: wave5ald/wavefocusEXE  (WaveFocus-<version>-Setup.exe)
       - Android: wave5ald/wavefocusAPK  (WaveFocus-<version>.apk)
  2. Run this script with the public HTTPS asset URLs. It computes SHA-256
     checksums and byte sizes, writes updates/version.json and can deploy the
     website (the only file the apps read).
  3. Both apps compare their installed version with this file on launch and
     show an update button when it is newer.

.EXAMPLE
  .\publish-update.ps1 `
    -Version 2.2.0 `
    -DownloadUrl "https://github.com/wave5ald/wavefocusEXE/releases/download/Release/WaveFocus-2.2.0-Setup.exe" `
    -InstallerPath "..\..\exe\WaveFocus-2.2.0.exe" `
    -ApkUrl "https://github.com/wave5ald/wavefocusAPK/releases/download/Release/WaveFocus-2.2.apk" `
    -ApkPath "..\..\apk\WaveFocus-2.2.apk" `
    -ApkVersionName "2.2" -ApkVersionCode 4 `
    -Notes "Bug fixes and faster sync" -Deploy
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$DownloadUrl,
    [string]$Notes = "Bug fixes and improvements",
    [string]$InstallerPath = "",
    [string]$ReleasePage = "https://github.com/wave5ald/wavefocusEXE/releases/tag/Release",
    # Android (optional: omit to leave the Android block untouched)
    [string]$ApkUrl = "",
    [string]$ApkPath = "",
    [string]$ApkVersionName = "",
    [int]$ApkVersionCode = 0,
    [string]$ApkNotes = "",
    [switch]$Deploy
)

$ErrorActionPreference = "Stop"

if (-not ($Version -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')) {
    throw "Version must be semantic, e.g. 2.1.0 or 2.1.0-beta.1"
}
if (-not ($DownloadUrl -match '^https://')) {
    throw "DownloadUrl must use HTTPS (the app refuses insecure downloads)."
}
if ($ApkUrl -and -not ($ApkUrl -match '^https://')) {
    throw "ApkUrl must use HTTPS (the app refuses insecure downloads)."
}

$candidates = @(
    (Join-Path $PSScriptRoot "..\updates\version.json"),
    (Join-Path $PSScriptRoot "..\website\updates\version.json"),
    (Join-Path $PSScriptRoot "..\pwa\updates\version.json"),
    (Join-Path $PSScriptRoot "updates\version.json")
)
$manifestPath = $candidates | Where-Object { Test-Path (Split-Path $_ -Parent) } | Select-Object -First 1
if (-not $manifestPath) { throw "Could not locate an updates folder." }

function Get-Digest([string]$path) {
    return @{
        Sha  = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
        Size = (Get-Item $path).Length
    }
}

$exeDigest = @{ Sha = ""; Size = 0 }
if ($InstallerPath) {
    if (-not (Test-Path $InstallerPath)) { throw "Installer not found: $InstallerPath" }
    $exeDigest = Get-Digest $InstallerPath
}

$payload = [ordered]@{
    version       = $Version
    download_url  = $DownloadUrl
    release_notes = $Notes
    release_page  = $ReleasePage
    sha256        = $exeDigest.Sha
    size_bytes    = $exeDigest.Size
}

if ($ApkUrl) {
    if (-not $ApkVersionName) { throw "ApkVersionName is required with ApkUrl (e.g. 2.2)" }
    if ($ApkVersionCode -le 0) { throw "ApkVersionCode is required with ApkUrl (e.g. 4)" }
    $apkDigest = @{ Sha = ""; Size = 0 }
    if ($ApkPath) {
        if (-not (Test-Path $ApkPath)) { throw "APK not found: $ApkPath" }
        $apkDigest = Get-Digest $ApkPath
    }
    $payload["android"] = [ordered]@{
        version_name  = $ApkVersionName
        version_code  = $ApkVersionCode
        apk_url       = $ApkUrl
        release_notes = $(if ($ApkNotes) { $ApkNotes } else { $Notes })
        sha256        = $apkDigest.Sha
        size_bytes    = $apkDigest.Size
    }
} elseif (Test-Path $manifestPath) {
    # Keep any previously published Android section so a desktop-only release
    # never makes the phones forget about the latest APK.
    try {
        $existing = Get-Content $manifestPath -Raw | ConvertFrom-Json
        if ($existing.android) { $payload["android"] = $existing.android }
    } catch { }
}

$json = $payload | ConvertTo-Json -Depth 5
# PowerShell pads JSON with `"key":  value`; keep one space so the file stays tidy.
$json = $json -replace '(?m)^(\s*"[^"]+"):\s+', '$1: '
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $manifestPath"
Write-Host $json

if ($Deploy) {
    $deployRoot = Split-Path $manifestPath -Parent
    while ($deployRoot -and -not (Test-Path (Join-Path $deployRoot "firebase.json"))) {
        $parent = Split-Path $deployRoot -Parent
        if (-not $parent -or $parent -eq $deployRoot) { break }
        $deployRoot = $parent
    }
    if (-not (Test-Path (Join-Path $deployRoot "firebase.json"))) {
        throw "Could not find firebase.json above $manifestPath"
    }
    Push-Location $deployRoot
    try {
        if (Get-Command firebase -ErrorAction SilentlyContinue) {
            firebase deploy --only hosting --project gen-lang-client-0965379779
        } else {
            Write-Host "firebase CLI is not on PATH; using npx firebase-tools..."
            npx --yes firebase-tools deploy --only hosting --project gen-lang-client-0965379779
        }
    } finally {
        Pop-Location
    }
}
