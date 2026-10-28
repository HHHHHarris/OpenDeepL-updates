import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from core.document_batch import translate_batch
from core.open_deepl_core import TranslationError


class DocumentBatchTests(unittest.TestCase):
    def test_jobs_are_sequential_and_failure_keeps_completed_results(self):
        events = []
        jobs = [{'input': '/fixtures/good.docx', 'output': '/out/good.docx'},
                {'input': '/fixtures/bad.pdf', 'output': '/out/bad.pdf'},
                {'input': '/fixtures/next.pptx', 'output': '/out/next.pptx'}]
        def translate(source, output, request, progress, **kwargs):
            if 'bad' in source:
                raise TranslationError('Invalid or damaged PDF document.')
            progress({'phase': 'assembling', 'completed': 1, 'total': 1})
            return {'output': output, 'translatedSegments': 2}
        with patch('core.document_batch.translate_document', side_effect=translate) as call:
            result = translate_batch(jobs, on_event=events.append)
        self.assertEqual(call.call_count, 3)
        self.assertEqual((result['completed'], result['failed']), (2, 1))
        self.assertEqual([x['status'] for x in result['items']], ['completed', 'failed', 'completed'])
        self.assertEqual(events[0]['progress']['fileName'], 'good.docx')
        self.assertEqual(events[-1]['fileIndex'], 3)

    def test_unexpected_exception_does_not_export_document_text(self):
        with patch('core.document_batch.translate_document', side_effect=RuntimeError('PRIVATE_SOURCE')):
            result = translate_batch([{'input': '/a.docx', 'output': '/b.docx'}])
        self.assertNotIn('PRIVATE_SOURCE', str(result))
        self.assertIn('DOC_UNEXPECTED', result['items'][0]['message'])

    def test_rejects_empty_and_oversized_queues(self):
        for jobs in ([], [{}] * 21, None):
            with self.assertRaises(TranslationError):
                translate_batch(jobs)

    def test_malformed_document_uses_real_parser_without_loading_model(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'broken.docx'
            target = Path(directory) / 'translated.docx'
            source.write_bytes(b'broken archive')
            result = translate_batch([{'input': str(source), 'output': str(target)}], translator=lambda _: 'translation')
            self.assertEqual(result['failed'], 1)
            self.assertFalse(target.exists())
            self.assertEqual(source.read_bytes(), b'broken archive')
