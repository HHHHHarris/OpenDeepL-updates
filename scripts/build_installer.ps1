param([Parameter(Mandatory=$true)][string]$Iscc,[string]$BundleDirectory)
$ErrorActionPreference='Stop'
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Version=(Get-Content -Raw (Join-Path $Root 'package.json') | ConvertFrom-Json).version
$Bundle=if ($BundleDirectory) { (Resolve-Path $BundleDirectory).Path } else { Join-Path $Root 'dist\OpenDeepL-win-portable' }
if (!(Test-Path (Join-Path $Bundle 'resources\runtime\python\python.exe'))) { throw 'Build and verify the self-contained portable bundle first.' }
& $Iscc "/DAppVersion=$Version" "/DBundleDir=$Bundle" (Join-Path $PSScriptRoot 'windows_installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compiler failed.' }
