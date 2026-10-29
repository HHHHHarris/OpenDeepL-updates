# Run on Windows after `npm ci`; produces a portable ZIP, no installer or auto-start.
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Source = Join-Path $Root 'node_modules\electron\dist'
if (!(Test-Path (Join-Path $Source 'electron.exe'))) { throw 'Run npm ci and node node_modules/electron/install.js on Windows first.' }
if (!(Test-Path (Join-Path $Root 'ui\index.html'))) { throw 'Missing ui\index.html.' }
$Out = if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $Root 'dist\OpenDeepL-win-portable' }
$Zip = $Out + '.zip'
New-Item -ItemType Directory -Force (Join-Path $Root 'dist') | Out-Null
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
Copy-Item -Recurse $Source $Out
$Runtime = Join-Path $Root 'dist\runtime\windows-x64'
if (!(Test-Path (Join-Path $Runtime 'python\python.exe')) -or !(Test-Path (Join-Path $Runtime 'llama\llama-server.exe'))) { throw 'Missing prepared Windows runtime. Run scripts/prepare_runtime.py --target windows-x64 first.' }
Copy-Item -Recurse $Runtime (Join-Path $Out 'resources\runtime')
$App = Join-Path $Out 'resources\app'
New-Item -ItemType Directory -Force $App | Out-Null
foreach ($Item in @('core','electron','ui','platform','assets')) {
  $From = Join-Path $Root $Item
  if (Test-Path $From) { Copy-Item -Recurse $From (Join-Path $App $Item) }
}
# Python cache files are machine-local build byproducts, not distributable
# source. Remove them only from the fresh staged app tree, never the checkout.
Get-ChildItem -LiteralPath $App -Directory -Recurse -Filter '__pycache__' |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
Get-ChildItem -LiteralPath $App -File -Recurse -Filter '*.pyc' |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
Copy-Item (Join-Path $Root 'package.json') (Join-Path $App 'package.json')
Copy-Item (Join-Path $Root 'LICENSE') $App
Copy-Item (Join-Path $Root 'THIRD_PARTY_NOTICES.md') $App
Rename-Item (Join-Path $Out 'electron.exe') 'OpenDeepL.exe'
& (Join-Path $Runtime 'python\python.exe') (Join-Path $Root 'scripts\package_windows.py') $Out $Zip
if ($LASTEXITCODE -ne 0) { throw 'Portable archive verification failed.' }
Write-Host "Built: $Zip"
