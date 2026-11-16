<#
.SYNOPSIS
  Publishes a new Wave Focus Windows release manifest (version.json).

.DESCRIPTION
  1. Upload the new installer (WaveFocus-<version>-Setup.exe) to a GitHub
     Release (or any HTTPS host).
  2. Run this script with the public download URL. It computes the SHA-256
     checksum and writes updates/version.json for the website.
  3. Deploy hosting (or pass -Deploy).

.EXAMPLE
  .\publish-update.ps1 -Version 2.1.0 `
    -DownloadUrl "https://github.com/<owner>/<repo>/releases/download/v2.1.0/WaveFocus-2.1.0-Setup.exe" `
    -InstallerPath "..\..\wavefocus\dist\WaveFocus-2.0.0-Setup.exe" `
    -Notes "Bug fixes and faster sync" -Deploy
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$DownloadUrl,
    [string]$Notes = "Bug fixes and improvements",
    [string]$InstallerPath = "",
    [string]$ReleasePage = "https://gen-lang-client-0965379779.web.app/",
    [switch]$Deploy
)

$ErrorActionPreference = "Stop"

if (-not ($Version -match '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$')) {
    throw "Version must be semantic, e.g. 2.1.0 or 2.1.0-beta.1"
}
if (-not ($DownloadUrl -match '^https://')) {
    throw "DownloadUrl must use HTTPS (the app refuses insecure downloads)."
}

$candidates = @(
    (Join-Path $PSScriptRoot "..\website\updates\version.json"),
    (Join-Path $PSScriptRoot "..\pwa\updates\version.json"),
    (Join-Path $PSScriptRoot "updates\version.json")
)
$manifestPath = $candidates | Where-Object { Test-Path (Split-Path $_ -Parent) } | Select-Object -First 1
if (-not $manifestPath) { throw "Could not locate an updates folder." }

$sha = ""
$size = 0
if ($InstallerPath) {
    if (-not (Test-Path $InstallerPath)) { throw "Installer not found: $InstallerPath" }
    $sha = (Get-FileHash $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item $InstallerPath).Length
}

$payload = [ordered]@{
    version      = $Version
    download_url = $DownloadUrl
    release_notes = $Notes
    release_page = $ReleasePage
    sha256       = $sha
    size_bytes   = $size
}

$json = $payload | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Wrote $manifestPath"
Write-Host $json

if ($Deploy) {
    Push-Location (Split-Path $manifestPath -Parent | Split-Path -Parent)
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
