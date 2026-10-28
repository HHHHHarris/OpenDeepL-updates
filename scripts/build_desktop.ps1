# Run on Windows after `npm ci`; produces a portable ZIP, no installer or auto-start.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Source = Join-Path $Root 'node_modules\electron\dist'
if (!(Test-Path (Join-Path $Source 'electron.exe'))) { throw 'Run npm ci on Windows first.' }
if (!(Test-Path (Join-Path $Root 'ui\index.html'))) { throw 'Missing ui\index.html.' }
$Out = Join-Path $Root 'dist\OpenDeepL-win-portable'
$Zip = Join-Path $Root 'dist\OpenDeepL-win-portable.zip'
New-Item -ItemType Directory -Force (Join-Path $Root 'dist') | Out-Null
if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
Copy-Item -Recurse $Source $Out
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
Rename-Item (Join-Path $Out 'electron.exe') 'OpenDeepL.exe'
if (Test-Path $Zip) { Remove-Item -Force $Zip }
Compress-Archive -Path (Join-Path $Out '*') -DestinationPath $Zip
Write-Host "Built: $Zip"
