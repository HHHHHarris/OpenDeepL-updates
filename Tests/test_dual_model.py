"""Dual-model protocol and lifecycle tests; no weights or listeners required."""
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from core import open_deepl_core as core


class Stream:
    def __init__(self):
        payload = {'choices': [{'delta': {'content': '译文'}}]}
        self.chunks = [('data: ' + json.dumps(payload, ensure_ascii=False) + '\n\n').encode(),
                       b'data: [DONE]\n\n']
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read1(self, _): return self.chunks.pop(0) if self.chunks else b''


class DualModelTests(unittest.TestCase):
    def test_default_and_mode_validation(self):
        self.assertEqual(core.TranslationRequest.from_dict({'text': 'x'}).modelMode, 'quality')
        with self.assertRaisesRegex(core.TranslationError, 'mode'):
            core.build_messages(core.TranslationRequest('x', modelMode='invalid'))

    def test_status_reads_only_and_uses_owned_port(self):
        engine = core.DualModelEngine()
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *_): self.close()
        def fake_open(request, timeout):
            self.assertEqual(request.full_url, 'http://127.0.0.1:18082/v1/models')
            return Response(b'{"data":[{"id":"hy-mt2-1.8b-q8_0","status":{"value":"unloaded"}}]}')
        with patch.object(engine.opener, 'open', side_effect=fake_open), patch.object(engine, '_start_if_needed') as start:
            self.assertEqual(engine.model_status('fast'), 'unloaded')
            start.assert_not_called()

    def test_fast_request_pins_alias_and_no_fallback(self):
        engine = core.DualModelEngine()
        bodies = []
        def fake_open(path, data=None, timeout=5):
            if path == '/v1/chat/completions':
                bodies.append(json.loads(data))
                return Stream()
            raise AssertionError(path)
        with tempfile.TemporaryDirectory() as td, patch('core.model_lifecycle.OPERATION_LOCK', Path(td)/'op.lock'), \
             patch('core.model_lifecycle.RUNTIME', Path(td)), \
             patch('core.model_lifecycle.model_available', return_value=True), \
             patch.object(engine, '_external_active', return_value=False), \
             patch.object(engine, '_start_if_needed'), \
             patch.object(engine, 'model_status', return_value='unloaded'), \
             patch.object(engine, '_open', side_effect=fake_open):
            self.assertEqual(engine.translate(core.TranslationRequest('Hello', modelMode='fast')), '译文')
        self.assertEqual(bodies[0]['model'], core.FAST_MODEL)
        with patch('core.model_lifecycle.model_available', return_value=False), \
             patch.object(engine, '_start_if_needed') as start:
            with self.assertRaises(core.LocalEngineError) as error:
                engine.translate(core.TranslationRequest('Hello', modelMode='fast'))
            self.assertEqual(error.exception.code, 'LOCAL_MODEL_MISSING')
            start.assert_not_called()

    def test_history_records_actual_model(self):
        with tempfile.TemporaryDirectory() as td:
            item = core.LocalStore(Path(td)).add_history(core.TranslationRequest('x', modelMode='fast'), 'y')
        self.assertEqual((item['modelMode'], item['modelId']), ('fast', core.FAST_MODEL))

    def test_switch_waits_until_prior_stream_finishes(self):
        first = threading.Event()
        release = threading.Event()
        entered = []
        errors = []
        class WaitingStream(Stream):
            def read1(self, n):
                if not first.is_set():
                    first.set()
                    if not release.wait(2):
                        raise TimeoutError('test stream was not released')
                return super().read1(n)
        engine = core.DualModelEngine()
        def fake_open(path, data=None, timeout=5):
            if path != '/v1/chat/completions':
                raise AssertionError(path)
            entered.append(json.loads(data)['model'])
            return WaitingStream() if len(entered) == 1 else Stream()
        def run(mode):
            try:
                engine.translate(core.TranslationRequest('Hello', modelMode=mode))
            except Exception as exc:
                errors.append(exc)
        with tempfile.TemporaryDirectory() as td, patch('core.model_lifecycle.OPERATION_LOCK', Path(td)/'op.lock'), \
             patch('core.model_lifecycle.RUNTIME', Path(td)), \
             patch('core.model_lifecycle.model_available', return_value=True), \
             patch.object(engine, '_external_active', return_value=False), \
             patch.object(engine, '_start_if_needed'), \
             patch.object(engine, 'model_status', return_value='unloaded'), \
             patch.object(engine, '_open', side_effect=fake_open):
            a = threading.Thread(target=run, args=('fast',))
            b = threading.Thread(target=run, args=('quality',))
            a.start()
            self.assertTrue(first.wait(2))
            b.start()
            time.sleep(.05)
            self.assertEqual(entered, [core.FAST_MODEL])
            release.set()
            a.join(2)
            b.join(2)
        self.assertFalse(errors)
        self.assertEqual(entered, [core.FAST_MODEL, core.MODEL])

    def test_health_no_router_query_or_launcher(self):
        output = io.StringIO()
        with patch.object(core, 'DualModelEngine') as engine, \
             patch('sys.stdin', io.StringIO('{"action":"health"}\n')), \
             patch('sys.stdout', output), \
             patch.object(core, 'default_data_dir', return_value=Path('/tmp')):
            core.serve_stdio()
            engine.return_value.status.assert_not_called()
            engine.return_value.translate.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['modelModes'], ['quality', 'fast'])


if __name__ == '__main__': unittest.main()
