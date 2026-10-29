"""PDF backend invariants using permissive PDF libraries only."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import unittest

from pypdf import PdfReader, PdfWriter
from pypdf.generic import IndirectObject, StreamObject
from reportlab.pdfgen import canvas

from core.documents import translate_document
from core.open_deepl_core import TranslationError


FIXTURE = Path(__file__).resolve().parents[1] / 'Tests/fixtures/documents/sample.pdf'


class PdfBackendTests(unittest.TestCase):
    def test_source_text_is_excised_not_visually_covered(self):
        before = hashlib.sha256(FIXTURE.read_bytes()).digest()
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / 'result.pdf'
            report = translate_document(FIXTURE, output, translator=lambda req: '你好世界')
            self.assertEqual(report['translatedSegments'], 1)
            self.assertEqual(hashlib.sha256(FIXTURE.read_bytes()).digest(), before)
            original, translated = PdfReader(FIXTURE), PdfReader(output)
            self.assertEqual(len(original.pages), len(translated.pages))
            self.assertEqual(original.pages[0].mediabox, translated.pages[0].mediabox)
            self.assertEqual(len(original.pages[0]['/Annots']), len(translated.pages[0]['/Annots']))
            self.assertEqual(len(original.pages[0]['/Resources']['/XObject']),
                             len(translated.pages[0]['/Resources']['/XObject']))
            self.assertNotIn('Hello world', translated.pages[0].extract_text())
            self.assertIn('你好世界', translated.pages[0].extract_text())
            self.assertNotIn(b'Hello world', output.read_bytes())
            for generation, ids in translated.xref.items():
                for id_number in ids:
                    item = IndirectObject(id_number, generation, translated).get_object()
                    if isinstance(item, StreamObject):
                        self.assertNotIn(b'Hello world', item.get_data())

    def test_unsupported_late_scanned_page_preflight_has_no_model_call(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'source.pdf'
            writer = PdfWriter(clone_from=PdfReader(FIXTURE))
            writer.add_blank_page(width=100, height=100)
            writer.write(path)
            calls = []
            # Blank pages are benign; a drawn image-only page is not.
            image_pdf = Path(td) / 'image.pdf'
            c = canvas.Canvas(str(image_pdf), pagesize=(100, 100))
            c.rect(10, 10, 80, 80)
            c.save()
            writer = PdfWriter(clone_from=PdfReader(FIXTURE))
            writer.append(PdfReader(image_pdf))
            writer.write(path)
            output = Path(td) / 'output.pdf'
            with self.assertRaisesRegex(TranslationError, 'page 2 has no extractable text'):
                translate_document(path, output, translator=lambda req: calls.append(req.text) or '译文')
            self.assertEqual(calls, [])
            self.assertFalse(output.exists())

    def test_embedded_unicode_and_multiple_show_operators(self):
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        font = os.environ.get('OPENDEEPL_PDF_FONT')
        if not font:
            self.skipTest('Set OPENDEEPL_PDF_FONT to the bundled OFL font')
        pdfmetrics.registerFont(TTFont('FixtureCJK', font))
        with tempfile.TemporaryDirectory() as td:
            source, output = Path(td) / 'unicode.pdf', Path(td) / 'out.pdf'
            c = canvas.Canvas(str(source), pagesize=(600, 300))
            text = c.beginText(30, 220)
            text.setFont('FixtureCJK', 20)
            text.textOut('请在星期五之前')
            text.textOut('不要发货。')
            c.drawText(text)
            c.save()
            before = source.read_bytes()
            calls = []
            translate_document(source, output, request={'targetLanguage':'English'},
                               translator=lambda req: calls.append(req.text) or 'Do not ship before Friday.')
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(calls, ['请在星期五之前不要发货。'])
            extracted = PdfReader(output).pages[0].extract_text()
            self.assertIn('Do not ship before Friday.', extracted)
            self.assertNotIn('星期五', extracted)

    def test_overflow_has_no_output(self):
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / 'result.pdf'
            with self.assertRaisesRegex(TranslationError, 'overflow'):
                translate_document(FIXTURE, output, translator=lambda req: '中文' * 500)
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(td).glob('.*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
