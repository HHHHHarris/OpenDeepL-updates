$ErrorActionPreference = 'Stop'
$dest = if ($env:OPENDEEPL_DOCUMENT_PYTHON_HOME) { $env:OPENDEEPL_DOCUMENT_PYTHON_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenDeepL\python' }
$bootstrap = if ($env:OPENDEEPL_BOOTSTRAP_PYTHON) { $env:OPENDEEPL_BOOTSTRAP_PYTHON } else { 'py' }
if ($bootstrap -eq 'py') { & py -3 -m venv $dest } else { & $bootstrap -m venv $dest }
if ($LASTEXITCODE -ne 0) { throw 'Private Python venv creation failed.' }
$python = Join-Path $dest 'Scripts\python.exe'
& $python -m pip install --disable-pip-version-check --no-input --index-url https://pypi.org/simple 'pypdf==6.21.0' 'pypdfium2==5.3.0' 'reportlab==4.4.5' 'lxml==6.1.3'
if ($LASTEXITCODE -ne 0) { throw 'Local PDF dependencies installation failed.' }
& $python -c 'import pypdf, pypdfium2, reportlab, lxml; print("Local document dependencies ready")'
if ($LASTEXITCODE -ne 0) { throw 'Private document Python import check failed.' }
Write-Output "Document Python: $python"
