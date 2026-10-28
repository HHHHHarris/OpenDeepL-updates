"""Selected-text helper contracts; no live document or clipboard access."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SelectionTests(unittest.TestCase):
    def test_macos_helper_json_and_no_argument_contract(self):
        if sys.platform != 'darwin':
            self.skipTest('macOS only')
        # Build from source in a disposable directory; never read the live
        # focused element. Rejecting an argument happens before AX access.
        with tempfile.TemporaryDirectory() as td:
            helper = Path(td) / 'selection-macos'
            subprocess.run(['/usr/bin/swiftc', '-framework', 'AppKit',
                            '-framework', 'ApplicationServices',
                            str(ROOT / 'platform/SelectionMac.swift'), '-o', str(helper)],
                           check=True, capture_output=True, timeout=60)
            rejected = subprocess.run([str(helper), 'synthetic-argument'], capture_output=True, text=True)
            self.assertEqual(rejected.returncode, 4)
            self.assertEqual(json.loads(rejected.stdout)['error'], 'unsupported')
        module = load('selection_mac_contract', 'platform/selection_mac.py')
        with patch.object(module.sys, 'argv', ['selection_mac.py']), \
                patch.object(module.Path, 'is_file', return_value=True), \
                patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess(
                    [], 2, b'{"error":"permission_denied"}', b'')) as runner, \
                patch('builtins.print') as output:
            self.assertEqual(module.main(), 2)
        self.assertEqual(len(runner.call_args.args[0]), 1)
        self.assertEqual(json.loads(output.call_args.args[0])['error'], 'permission_denied')

    def test_windows_json_parser(self):
        module = load('selection_windows', 'platform/selection_windows.py')
        self.assertEqual(module._parse_response(b'\xef\xbb\xbf{"text":"\xe4\xb8\xad\xe6\x96\x87"}')['text'], '中文')
        with self.assertRaises(ValueError):
            module._parse_response(b'{}')

    def test_windows_invocation_never_contains_selected_text(self):
        module = load('selection_windows_mock', 'platform/selection_windows.py')
        captured = {}

        def run(argv, **kwargs):
            captured['argv'] = argv
            return subprocess.CompletedProcess(argv, 0, b'{"text":"synthetic secret","app":"fixture"}', b'')

        with patch.object(module.sys, 'platform', 'win32'), patch.object(module.sys, 'argv', ['selection_windows.py']), \
                patch.object(module.subprocess, 'run', side_effect=run), \
                patch.object(module.subprocess, 'CREATE_NO_WINDOW', 0, create=True), \
                patch('builtins.print') as output:
            self.assertEqual(module.main(), 0)
        self.assertNotIn('synthetic secret', ' '.join(captured['argv']))
        self.assertEqual(json.loads(output.call_args.args[0])['text'], 'synthetic secret')

    def test_windows_unsupported_on_other_platforms(self):
        if sys.platform == 'win32':
            self.skipTest('non-Windows only')
        result = subprocess.run([sys.executable, str(ROOT / 'platform' / 'selection_windows.py')],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 4)
        self.assertEqual(json.loads(result.stdout)['error'], 'unsupported')


if __name__ == '__main__':
    unittest.main()
