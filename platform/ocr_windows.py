#!/usr/bin/env python3
"""Offline Windows OCR: private RapidOCR first, installed WinRT OCR as fallback."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
if len(sys.argv) != 2 or not Path(sys.argv[1]).is_file():
    raise SystemExit(2)
mode = os.environ.get('OPENDEEPL_OCR_MODE', 'auto')
if mode == 'auto' and importlib.util.find_spec('rapidocr_onnxruntime') is not None:
    helper = Path(__file__).resolve().with_name('ocr_rapid.py')
    result = subprocess.run([sys.executable, str(helper), str(Path(sys.argv[1]).resolve())],
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=27,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=False)
    if result.returncode:
        sys.stderr.write(result.stderr.decode('utf-8', errors='replace') or
                         'Local RapidOCR failed.\n')
        raise SystemExit(1)
    payload = json.loads(result.stdout.decode('utf-8-sig'))
    if not isinstance(payload.get('text'), str):
        sys.stderr.write('Local RapidOCR returned no text field.\n')
        raise SystemExit(1)
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(0)
path = str(Path(sys.argv[1]).resolve()).replace("'", "''")
script = r'''
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.IRandomAccessStream,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrResult,Windows.Media.Ocr,ContentType=WindowsRuntime]
function Await($op,[Type]$resultType) {
 $m=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
 $task=$m.MakeGenericMethod($resultType).Invoke($null,@($op));$task.Wait();return $task.Result
}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('FILE_PATH')) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$available=@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
$availableTags=@($available | ForEach-Object { $_.LanguageTag })
$english=$available | Where-Object { $_.LanguageTag -eq 'en-US' } | Select-Object -First 1
$mode='OCR_MODE'
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if($null -eq $engine){throw 'No installed local OCR language'}
$profileTag=$engine.RecognizerLanguage.LanguageTag
$result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$retriedEnglish=$false
$fallbackReason=$null
$latinCount=([regex]::Matches($result.Text,'[A-Za-z]')).Count
$hanCount=([regex]::Matches($result.Text,'[\u4E00-\u9FFF]')).Count
if($mode -eq 'en-US' -or ($mode -eq 'auto' -and $hanCount -eq 0 -and $latinCount -ge 8)) {
 if($null -eq $english) {
  $fallbackReason='en-US recognizer is not installed'
 } else {
  try {
   $other=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($english)
   if($null -eq $other){throw 'en-US recognizer unavailable'}
   $alternate=Await ($other.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
   $retriedEnglish=$true
   $engine=$other
   $result=$alternate
  } catch { $fallbackReason='en-US recognition failed; profile result retained' }
 }
}
$lines = @($result.Lines | ForEach-Object {
  [pscustomobject]@{text=$_.Text; words=@($_.Words | ForEach-Object {
    [pscustomobject]@{text=$_.Text; x=$_.BoundingRect.X; width=$_.BoundingRect.Width}
  })}
})
@{lines=$lines;recognizer=$engine.RecognizerLanguage.LanguageTag;profileRecognizer=$profileTag;availableRecognizers=$availableTags;retriedEnglish=$retriedEnglish;fallbackReason=$fallbackReason;profileLatinCount=$latinCount;profileHanCount=$hanCount}|ConvertTo-Json -Compress -Depth 6
'''.replace('FILE_PATH', path).replace('OCR_MODE', os.environ.get('OPENDEEPL_OCR_MODE', 'auto') if os.environ.get('OPENDEEPL_OCR_MODE') in ('auto', 'profile', 'en-US') else 'auto')
encoded=base64.b64encode(script.encode('utf-16le')).decode('ascii')
result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
                      stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                      timeout=25,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0),check=False)
if result.returncode:
    raise SystemExit(1)
payload=json.loads(result.stdout.decode('utf-8-sig'))
lines=payload.get('lines') or []
if isinstance(lines,dict):
    lines=[lines]
line_text=[str(item.get('text','')) for item in lines]
print(json.dumps({'text':'\n'.join(line_text),'lines':line_text,
                  'words':[[word.get('text','') for word in item.get('words',[])] for item in lines],
                  'recognizer':payload.get('recognizer'),
                  'profileRecognizer':payload.get('profileRecognizer'),
                  'availableRecognizers':payload.get('availableRecognizers'),
                  'retriedEnglish':payload.get('retriedEnglish'),
                  'fallbackReason':payload.get('fallbackReason'),
                  'profileLatinCount':payload.get('profileLatinCount'),
                  'profileHanCount':payload.get('profileHanCount')},
                 ensure_ascii=True))
