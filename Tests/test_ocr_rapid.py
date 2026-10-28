"""RapidOCR local-only contract and source-fixture regression."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'platform' / 'ocr_rapid.py'
spec = importlib.util.spec_from_file_location('ocr_rapid', HELPER)
ocr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ocr)


class OfflineOcrTests(unittest.TestCase):
    def test_line_sorting_keeps_punctuation_and_units(self):
        raw = [
            ([[130, 40], [240, 40], [240, 60], [130, 60]], '750 mL', .98),
            ([[10, 40], [120, 40], [120, 60], [10, 60]], 'Volume:', .99),
            ([[10, 5], [120, 5], [120, 25], [10, 25]], 'Price: $19.99', .99),
        ]
        self.assertEqual(ocr.organize(raw)['text'], 'Price: $19.99\nVolume: 750 mL')

    def test_geometry_only_deduplicates_same_overlapping_glyph(self):
        raw = [
            ([[0, 0], [110, 0], [110, 30], [0, 30]], 'Capacity: 7', .95,
             [[[90, 0], [120, 0], [120, 30], [90, 30]]]),
            ([[100, 0], [200, 0], [200, 30], [100, 30]], '750 mL', .95,
             [[[105, 0], [124, 0], [124, 30], [105, 30]]]),
        ]
        self.assertEqual(ocr.organize(raw)['text'], 'Capacity: 750 mL')
        raw[1] = (raw[1][0], '850 mL', raw[1][2], raw[1][3])
        self.assertIn('7850 mL', ocr.organize(raw)['text'])

    def test_missing_weights_fail_closed(self):
        with tempfile.TemporaryDirectory() as path:
            with self.assertRaisesRegex(RuntimeError, 'model missing'):
                ocr.verify_models(path)

    @unittest.skipUnless(os.environ.get('OPENDEEPL_OCR_PYTHON'), 'OCR Python not specified')
    def test_real_fixture_offline_subprocess(self):
        python = os.environ['OPENDEEPL_OCR_PYTHON']
        run = subprocess.run([python, str(HELPER), str(ROOT / 'Tests' / 'fixtures' / 'ocr-sample.png')],
                             env={**os.environ, 'HTTP_PROXY': 'http://127.0.0.1:1',
                                  'HTTPS_PROXY': 'http://127.0.0.1:1'},
                             text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             timeout=60, check=True)
        data = json.loads(run.stdout)
        self.assertEqual(data['engine'], ocr.ENGINE)
        self.assertEqual(data['text'], 'Price: $19.99\nVolume: 750 ml\nDo not ship before Friday.')
        self.assertEqual(len(data['lines']), 3)


if __name__ == '__main__':
    unittest.main()
