$ErrorActionPreference = 'Stop'
# Provisioning only; the OCR helper has no runtime network access.
$dest = if ($env:OPENDEEPL_OCR_PYTHON_HOME) { $env:OPENDEEPL_OCR_PYTHON_HOME } else { Join-Path $env:LOCALAPPDATA 'OpenDeepL\python' }
$bootstrap = if ($env:OPENDEEPL_BOOTSTRAP_PYTHON) { $env:OPENDEEPL_BOOTSTRAP_PYTHON } else { 'py' }
$python = Join-Path $dest 'Scripts\python.exe'
if (-not (Test-Path $python)) {
  if ($bootstrap -eq 'py') { & py -3.12 -m venv $dest } else { & $bootstrap -m venv $dest }
  if ($LASTEXITCODE -ne 0) { throw 'Private Python venv creation failed.' }
}
& $python -m pip install --disable-pip-version-check --no-input --index-url https://pypi.org/simple `
  'rapidocr-onnxruntime==1.4.4' 'onnxruntime==1.31.0' 'numpy==2.5.4' `
  'opencv-python==5.0.0.93' 'pyclipper==1.4.0' 'shapely==2.2.0' `
  'PyYAML==6.0.3' 'Pillow==13.0.0' 'six==1.17.0' 'tqdm==4.70.1' `
  'flatbuffers==25.12.19' 'packaging==26.3' 'protobuf==7.36.2'
if ($LASTEXITCODE -ne 0) { throw 'Private OCR dependency installation failed.' }
$root = Split-Path -Parent $PSScriptRoot
& $python (Join-Path $root 'platform\ocr_rapid.py') (Join-Path $root 'Tests\fixtures\ocr-sample.png') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Private OCR weight verification failed.' }
Write-Output "OCR Python: $python"
