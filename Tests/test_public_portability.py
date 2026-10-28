"""Public source defaults; no installed app, model, or signing identity needed."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PublicPortabilityTests(unittest.TestCase):
    def _config(self, platform, overrides=None):
        with tempfile.TemporaryDirectory() as home:
            env = {**os.environ, 'HOME': home, 'USERPROFILE': home}
            for key in ('OPENDEEPL_QUALITY_MODEL', 'OPENDEEPL_FAST_MODEL',
                        'OPENDEEPL_CHAT_TEMPLATE'):
                env.pop(key, None)
            env.update(overrides or {})
            code = ("import json,sys,importlib;from core import model_lifecycle as m;"
                    "sys.platform=%r;importlib.reload(m);"
                    "print(json.dumps([str(m.APP),str(m.QUALITY),str(m.FAST),str(m.TEMPLATE)]))") % platform
            output = subprocess.check_output([sys.executable, '-c', code], cwd=ROOT, env=env, text=True)
            import json
            return json.loads(output), home

    def test_macos_defaults_are_app_owned(self):
        values, home = self._config('darwin')
        app = Path(home) / 'Library/Application Support/OpenDeepL'
        self.assertEqual(values, [str(app), str(app / 'models/HY-MT2-7B-Q8_0.gguf'),
                                  str(app / 'models/Hy-MT2-1.8B-Q8_0.gguf'),
                                  str(app / 'runtime/hunyuan-translation.jinja')])

    def test_windows_defaults_are_app_owned(self):
        with tempfile.TemporaryDirectory() as home:
            values, _ = self._config('win32', {'LOCALAPPDATA': home})
            app = Path(home) / 'OpenDeepL'
            self.assertEqual(values, [str(app), str(app / 'models/HY-MT2-7B-Q8_0.gguf'),
                                      str(app / 'models/Hy-MT2-1.8B-Q8_0.gguf'),
                                      str(app / 'runtime/hunyuan-translation.jinja')])

    def test_explicit_model_and_template_overrides(self):
        values, _ = self._config('darwin', {
            'OPENDEEPL_QUALITY_MODEL': '/tmp/quality.gguf',
            'OPENDEEPL_FAST_MODEL': '/tmp/fast.gguf',
            'OPENDEEPL_CHAT_TEMPLATE': '/tmp/chat.jinja'})
        self.assertEqual(values[1:], ['/tmp/quality.gguf', '/tmp/fast.gguf', '/tmp/chat.jinja'])

    def test_synthetic_ocr_fixture_exists(self):
        path = ROOT / 'Tests/fixtures/ocr-sample.png'
        self.assertGreater(path.stat().st_size, 1000)
        self.assertEqual(path.read_bytes()[:8], b'\x89PNG\r\n\x1a\n')


if __name__ == '__main__':
    unittest.main()
