import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import io
import urllib.request
from core.open_deepl_core import (GlossaryEntry, LocalStore, SSEParser,
                                  TranslationRequest, TranslationError, build_messages, OfflineEngine, _NoRedirect)

class CoreTests(unittest.TestCase):
    def test_prompt_options(self):
        r = TranslationRequest('Hello', 'English', 'Chinese', 'formal',
                               (GlossaryEntry('Brand', '品牌', 'g1'),))
        messages = build_messages(r)
        self.assertEqual(messages[1]['content'], 'Hello')
        self.assertIn('English', messages[0]['content'])
        self.assertIn('formal', messages[0]['content'])
        self.assertIn('Brand => 品牌', messages[0]['content'])

    def test_sse_split_unicode_and_done(self):
        parser = SSEParser()
        stream = ('data: '+json.dumps({'choices':[{'delta':{'content':'你好'}}]},ensure_ascii=False)+'\r\n\r\n'
                  'data: [DONE]\r\n\r\n').encode()
        got = []
        for byte in stream:
            got.extend(parser.feed(bytes([byte])))
        self.assertEqual(got, ['你好'])
        self.assertEqual(parser.finish(), '你好')

    def test_truncated_sse_raises(self):
        parser = SSEParser()
        parser.feed(b'data: {"choices": [{"delta": {"content": "x"}}]}\n\n')
        with self.assertRaises(TranslationError): parser.finish()

    def test_status_never_starts_and_uses_pinned_loopback(self):
        engine = OfflineEngine()
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *args): self.close()
        def fake_open(request, timeout):
            self.assertEqual(request.full_url, 'http://127.0.0.1:18081/v1/models')
            return Response(b'{"data":[{"id":"hy-mt2-7b-q8_0","status":{"value":"sleeping","args":["sensitive"]}}]}')
        with patch.object(engine.opener, 'open', side_effect=fake_open), patch.object(engine, '_start_if_needed') as start:
            self.assertEqual(engine.status(), 'sleeping')
            start.assert_not_called()
        self.assertTrue(any(isinstance(h, _NoRedirect) for h in engine.opener.handlers))

    def test_redirect_is_rejected(self):
        with self.assertRaises(TranslationError):
            _NoRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://example.com')

    def test_sse_length_is_not_success(self):
        parser = SSEParser()
        parser.feed(b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
        with self.assertRaisesRegex(TranslationError, 'complete translation'):
            parser.feed(b'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n'
                        b'data: [DONE]\n\n')

    def test_storage_bounded_and_atomic(self):
        with tempfile.TemporaryDirectory() as td:
            store = LocalStore(Path(td))
            req = TranslationRequest('source')
            for n in range(202): store.add_history(req, str(n))
            self.assertEqual(len(store.history()), 200)
            self.assertEqual(store.history()[0]['translation'], '201')
            store.remove_history(store.history()[0]['id'])
            self.assertEqual(len(store.history()), 199)
            store.save_glossary([GlossaryEntry('a','b','id')])
            self.assertEqual(store.glossary()[0]['id'], 'id')
            store.clear_history()
            self.assertEqual(store.history(), [])

if __name__ == '__main__': unittest.main()
