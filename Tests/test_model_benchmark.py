import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/benchmark_translation_models.py'
spec = importlib.util.spec_from_file_location('benchmark_translation_models', SCRIPT)
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def test_fixture_coverage(self):
        rows = json.loads(benchmark.FIXTURES.read_text())
        self.assertGreaterEqual(len(rows), 20)
        self.assertEqual(len(rows), len({row['id'] for row in rows}))
        self.assertEqual({('en', 'zh'), ('zh', 'en')}, {(r['source'], r['target']) for r in rows})
        self.assertTrue({'email', 'product_spec', 'negation', 'terminology', 'multi_paragraph',
                         'quoted_command', 'placeholder_format'} <= {r['category'] for r in rows})
        self.assertEqual(24, len([r for r in rows if not r['id'].startswith('document_')]))
        self.assertEqual(3, len([r for r in rows if r['category'] == 'document_marker']))
        self.assertEqual(1, len([r for r in rows if r['category'] == 'long_form_spec']))

    def test_gemma_prompt_matches_official_text_branch(self):
        prompt = benchmark.gemma_prompt('en', 'zh', 'A6 paper')
        self.assertTrue(prompt.startswith('<start_of_turn>user\nYou are a professional English (en) to Chinese (zh) translator.'))
        self.assertNotIn('<bos>', prompt)
        self.assertIn('Please translate the following English text into Chinese:\n\n\nA6 paper', prompt)
        self.assertTrue(prompt.endswith('<end_of_turn>\n<start_of_turn>model\n'))
        self.assertNotIn('<start_of_turn>system', prompt)

    def test_conservative_checks_are_alerts_not_grades(self):
        checks = benchmark.conservative_checks('Order {{id}}: 750 mL', '订单 {{id}}：750毫升')
        self.assertTrue(checks['manual_review_required'])
        self.assertEqual([], checks['missing_placeholders'])
        self.assertEqual([], checks['missing_number_strings'])
        missing = benchmark.conservative_checks('Order {{id}}: 750 mL', '订单已发货')
        self.assertEqual(['{{id}}'], missing['missing_placeholders'])
        self.assertEqual(['750'], missing['missing_number_strings'])
        markers = benchmark.conservative_checks('⟦OD000⟧A⟦OD001⟧B', '⟦OD001⟧甲⟦OD000⟧乙')
        self.assertFalse(markers['protocol_markers_exact_and_ordered'])
        self.assertTrue(markers['manual_review_required'])

    def test_new_weight_requires_verified_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'model.gguf'
            evidence = Path(directory) / 'verified.json'
            path.write_bytes(b'test gguf fixture')
            with patch.dict(benchmark.MODEL, {'fixture': (path, evidence)}):
                with self.assertRaisesRegex(RuntimeError, 'No completed verification'):
                    benchmark.verified_weight('fixture')
                evidence.write_text(json.dumps({'verified': True, 'size': path.stat().st_size,
                                                'sha256': '0' * 64}))
                with self.assertRaisesRegex(RuntimeError, 'hash/size mismatch'):
                    benchmark.verified_weight('fixture')
                evidence.write_text(json.dumps({'verified': True, 'size': path.stat().st_size,
                                                'sha256': benchmark.sha256_file(path)}))
                self.assertEqual(path.stat().st_size, benchmark.verified_weight('fixture')['size'])


if __name__ == '__main__':
    unittest.main()
