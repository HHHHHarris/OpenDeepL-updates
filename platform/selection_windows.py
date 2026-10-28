#!/usr/bin/env python3
"""Read the selected text of the currently focused Windows UIA element only.

The PowerShell child receives executable code, never selected content, on argv.
No clipboard, keystrokes, window enumeration, or network is used.
"""
import base64
import json
import subprocess
import sys

_PS = r'''
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Emit($data, [int]$code) {
  $data | ConvertTo-Json -Compress -Depth 3
  exit $code
}
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $element) {
    Emit @{error='no_selection';message='Focus a text control and select text before using the shortcut.'} 3
  }
  $pattern = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
    if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern2]::Pattern, [ref]$pattern)) {
      Emit @{error='no_selection';message='The focused control does not expose a UI Automation TextPattern selection.'} 3
    }
  }
  $ranges = $pattern.GetSelection()
  if ($null -eq $ranges -or $ranges.Length -eq 0) {
    Emit @{error='no_selection';message='The focused text control has no selection.'} 3
  }
  $parts = New-Object 'System.Collections.Generic.List[string]'
  $remaining = 100001
  foreach ($range in $ranges) {
    if ($remaining -le 0) { break }
    $part = $range.GetText($remaining)
    if ($null -ne $part -and $part.Length -gt 0) {
      $parts.Add($part)
      $remaining -= $part.Length
    }
  }
  $text = [string]::Join("`n", $parts)
  if ($text.Length -eq 0) {
    Emit @{error='no_selection';message='The focused text control has no selected text.'} 3
  }
  if ($text.Length -gt 100000) {
    Emit @{error='too_long';message='Selection exceeds 100,000 characters.'} 6
  }
  $app = $null
  try {
    $pidOfElement = $element.Current.ProcessId
    if ($pidOfElement -gt 0) { $app = [System.Diagnostics.Process]::GetProcessById($pidOfElement).ProcessName }
  } catch {}
  if ($app) { Emit @{text=$text;app=$app} 0 }
  Emit @{text=$text} 0
} catch [System.UnauthorizedAccessException] {
  Emit @{error='permission_denied';message='UI Automation access was denied for the focused application.'} 2
} catch {
  Emit @{error='internal_error';message='UI Automation could not read focus; retry from the unlocked interactive desktop.'} 5
}
'''


def _parse_response(raw: bytes) -> dict:
    # PowerShell 5.1 with Console.OutputEncoding emits UTF-8. Some host settings
    # still prepend a BOM; utf-8-sig accepts both.
    payload = json.loads(raw.decode('utf-8-sig').strip())
    if not isinstance(payload, dict) or not ({'text', 'error'} & payload.keys()):
        raise ValueError('invalid selection response')
    return payload


def main() -> int:
    if len(sys.argv) != 1:
        print(json.dumps({'error': 'unsupported', 'message': 'Run without arguments.'}))
        return 4
    if sys.platform != 'win32':
        print(json.dumps({'error': 'unsupported', 'message': 'Windows UI Automation is required.'}))
        return 4
    try:
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand',
             base64.b64encode(_PS.encode('utf-16-le')).decode('ascii')],
            stdin=subprocess.DEVNULL, capture_output=True, timeout=6, check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        payload = _parse_response(result.stdout)
        print(json.dumps(payload, ensure_ascii=False))
        return result.returncode
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'error': 'internal_error', 'message': f'Selection helper failed: {type(exc).__name__}'}))
        return 5


if __name__ == '__main__':
    raise SystemExit(main())
