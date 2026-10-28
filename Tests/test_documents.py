import os
import hashlib
from pathlib import Path
import tempfile
import unittest
import uuid
import subprocess
import json
import sys
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from core.documents import translate_document
from core.open_deepl_core import TranslationError

FIXTURES = Path(__file__).parent / 'fixtures' / 'documents'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class DocumentTests(unittest.TestCase):
    def test_all_package_xml_is_validated_before_first_model_call(self):
        cases = ('word/header99.xml', 'word/styles.xml', 'word/footer99.xml')
        for name in cases:
            with self.subTest(part=name), tempfile.TemporaryDirectory() as td:
                source = Path(td) / 'late-broken.docx'
                payload = (b'<!DOCTYPE root [<!ENTITY hidden "SECRET">]><root/>'
                           if 'footer' in name else b'<unfinished>')
                with ZipFile(FIXTURES / 'sample.docx') as original, ZipFile(source, 'w') as changed:
                    for info in original.infolist():
                        if info.filename != name:
                            changed.writestr(info, original.read(info.filename))
                    changed.writestr(name, payload)
                calls = []
                output = Path(td) / 'translated.docx'
                before = digest(source)
                with self.assertRaisesRegex(TranslationError, 'Invalid or damaged document package'):
                    translate_document(source, output, translator=lambda req: calls.append(req.text) or '译文')
                self.assertEqual(calls, [])
                self.assertEqual(digest(source), before)
                self.assertFalse(output.exists())
                self.assertEqual(list(Path(td).glob('*.tmp')), [])

    def test_late_unsupported_pdf_page_is_rejected_before_first_model_call(self):
        import pymupdf as fitz
        for kind in ('scanned', 'rotated'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as td:
                source = Path(td) / 'late-unsupported.pdf'
                doc = fitz.open()
                doc.new_page().insert_text((40, 50), 'Do not ship before Friday.')
                page = doc.new_page()
                if kind == 'scanned':
                    page.draw_rect(fitz.Rect(40, 40, 200, 150))
                else:
                    page.insert_text((100, 200), 'Rotated text', rotate=90)
                doc.save(source)
                doc.close()
                calls = []
                output = Path(td) / 'translated.pdf'
                before = digest(source)
                with self.assertRaisesRegex(TranslationError, 'page 2'):
                    translate_document(source, output, translator=lambda req: calls.append(req.text) or '译文')
                self.assertEqual(calls, [])
                self.assertEqual(digest(source), before)
                self.assertFalse(output.exists())
                self.assertEqual(list(Path(td).glob('*.tmp')), [])

    def test_broken_opc_relationship_graph_fails_before_model_and_export(self):
        cases = ('missing-root-relationships', 'missing-office-target', 'missing-media', 'wrong-main-type', 'missing-presentation')
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as td:
                suffix = '.pptx' if case == 'missing-presentation' else '.docx'
                source = Path(td) / ('broken' + suffix)
                with ZipFile(FIXTURES / ('sample' + suffix)) as original, ZipFile(source, 'w') as changed:
                    for info in original.infolist():
                        if (case == 'missing-root-relationships' and info.filename == '_rels/.rels') or (case == 'missing-media' and '/media/' in info.filename) or (case == 'missing-presentation' and info.filename == 'ppt/presentation.xml'):
                            continue
                        data = original.read(info.filename)
                        if case == 'missing-office-target' and info.filename == '_rels/.rels':
                            data = data.replace(b'word/document.xml', b'word/missing.xml')
                        if case == 'wrong-main-type' and info.filename == '[Content_Types].xml':
                            data = data.replace(b'wordprocessingml.document.main+xml', b'wordprocessingml.template.main+xml')
                        changed.writestr(info, data)
                before = digest(source)
                calls = []
                output = Path(td) / ('translated' + suffix)
                temporary = Path(td) / f'.OpenDeepL-{uuid.uuid4()}.tmp'
                with self.assertRaisesRegex(TranslationError, 'Invalid or damaged document package'):
                    translate_document(source, output, translator=lambda req: calls.append(req.text) or '译文', temporary_path=temporary)
                self.assertEqual(calls, [])
                self.assertEqual(digest(source), before)
                self.assertFalse(output.exists())
                self.assertFalse(temporary.exists())

    def test_damaged_docx_reports_protocol_error_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'damaged.docx'
            src.write_bytes(b'not a ZIP archive')
            original = digest(src)
            output = Path(td) / 'translated.docx'
            temporary = Path(td) / f'.OpenDeepL-{uuid.uuid4()}.tmp'
            payload = {'id': 'damaged-document-test', 'action': 'translateDocument',
                       'input': str(src), 'output': str(output), 'temporary': str(temporary),
                       'request': {}}
            result = subprocess.run([sys.executable, '-u', '-m', 'core.open_deepl_core'],
                                    cwd=Path(__file__).parent.parent, input=json.dumps(payload) + '\n',
                                    text=True, capture_output=True, timeout=15)
            events = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(result.returncode, 0, result.stderr)
            errors = [event for event in events if event['type'] == 'error']
            self.assertEqual(len(errors), 1)
            self.assertIn('Invalid or damaged document package', errors[0]['message'])
            self.assertEqual(original, digest(src))
            self.assertFalse(output.exists())
            self.assertFalse(temporary.exists())

    def test_damaged_pdf_reports_error_and_cleans_temporary(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'damaged.pdf'
            src.write_bytes(b'%PDF-1.7\nnot a PDF')
            output = Path(td) / 'translated.pdf'
            temporary = Path(td) / f'.OpenDeepL-{uuid.uuid4()}.tmp'
            with self.assertRaisesRegex(TranslationError, 'Invalid or damaged PDF'):
                translate_document(src, output, translator=lambda req: req.text,
                                   temporary_path=temporary)
            self.assertFalse(output.exists())
            self.assertFalse(temporary.exists())

    def test_docx_package_media_and_styles_unchanged(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'sample.docx'
            src.write_bytes((FIXTURES / 'sample.docx').read_bytes())
            before = digest(src)
            progress = []
            def stub(request):
                return {'Hello ': '你好 ', 'world 2026': '世界 2026',
                        'Hello world ⟦OD000⟧': '你好世界 ⟦OD000⟧'}.get(request.text, '译' + request.text)
            report = translate_document(src, request={'targetLanguage': 'Chinese'},
                                        translator=stub, on_progress=progress.append)
            dst = Path(report['output'])
            self.assertEqual(before, digest(src))
            self.assertTrue(dst.is_file())
            self.assertGreater(report['translatedSegments'], 0)
            self.assertEqual(progress[-1]['phase'], 'complete')
            with ZipFile(src) as a, ZipFile(dst) as b:
                self.assertEqual(a.namelist(), b.namelist())
                for name in a.namelist():
                    if name not in report['changedParts']:
                        self.assertEqual(a.read(name), b.read(name), name)
                xml = ET.fromstring(b.read('word/document.xml'))
                texts = ''.join(n.text or '' for n in xml.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'))
                self.assertIn('你好世界 2026', texts)
                self.assertEqual(a.read('word/styles.xml'), b.read('word/styles.xml'))
                original_xml = a.read('word/document.xml')
                translated_xml = b.read('word/document.xml')
                for prefix in (b'xmlns:w14=', b'xmlns:wp14=', b'mc:Ignorable='):
                    self.assertIn(prefix, original_xml)
                    self.assertIn(prefix, translated_xml)
                self.assertEqual(a.read('word/media/image1.png'), b.read('word/media/image1.png'))
            with self.assertRaises(TranslationError):
                translate_document(src, request={}, translator=stub)

    def test_pptx_preserves_shapes_and_media(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'sample.pptx'
            src.write_bytes((FIXTURES / 'sample.pptx').read_bytes())
            before = digest(src)
            report = translate_document(src, translator=lambda r: '你好' if r.text == 'Hello' else r.text)
            self.assertEqual(before, digest(src))
            with ZipFile(src) as a, ZipFile(report['output']) as b:
                self.assertEqual(a.namelist(), b.namelist())
                for name in a.namelist():
                    if name != 'ppt/slides/slide1.xml':
                        self.assertEqual(a.read(name), b.read(name))
                tree = ET.fromstring(b.read('ppt/slides/slide1.xml'))
                self.assertIn('你好', ''.join(n.text or '' for n in tree.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t')))
                self.assertEqual(a.read('ppt/media/image1.png'), b.read('ppt/media/image1.png'))

    def test_placeholders_and_output_failure(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'sample.docx'
            src.write_bytes((FIXTURES / 'sample.docx').read_bytes())
            original = digest(src)
            with self.assertRaisesRegex(TranslationError, 'Placeholder mismatch'):
                translate_document(src, translator=lambda r: '数字丢失')
            self.assertEqual(original, digest(src))
            self.assertFalse(src.with_name('sample.translated.docx').exists())
            self.assertFalse(list(Path(td).glob('.*.tmp')))

    def test_pdf_geometry_and_overflow(self):
        try:
            import pymupdf as fitz
        except ImportError:
            self.skipTest('private PyMuPDF runtime needed')
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'sample.pdf'
            src.write_bytes((FIXTURES / 'sample.pdf').read_bytes())
            before = digest(src)
            report = translate_document(src, translator=lambda r: '你好世界' if r.text == 'Hello world' else r.text)
            self.assertEqual(before, digest(src))

            with fitz.open(src) as a, fitz.open(report['output']) as b:
                self.assertEqual(len(a), len(b))
                self.assertEqual(a[0].rect, b[0].rect)
                self.assertEqual(len(a[0].get_images()), len(b[0].get_images()))
                self.assertGreater(len(b[0].get_drawings()), 0)
                self.assertEqual(len(a[0].get_links()), len(b[0].get_links()))
                source_span = next(x for x in a[0].get_text('dict')['blocks'] if x['type'] == 0)['lines'][0]['spans'][0]
                output_span = next(x for x in b[0].get_text('dict')['blocks'] if x['type'] == 0)['lines'][0]['spans'][0]
                self.assertEqual(source_span['color'], output_span['color'])
                self.assertIn('你好世界', b[0].get_text())
                src_pix = a[0].get_pixmap(alpha=False)
                dst_pix = b[0].get_pixmap(alpha=False)
                self.assertEqual((src_pix.width, src_pix.height), (dst_pix.width, dst_pix.height))
            dst = Path(td) / 'overflow.pdf'
            with self.assertRaisesRegex(TranslationError, 'overflow'):
                translate_document(src, dst, translator=lambda r: '超长翻译文字' * 100)
            self.assertFalse(dst.exists())
            self.assertEqual(before, digest(src))

    def test_pdf_subsets_cjk_font_without_losing_structure(self):
        import pymupdf as fitz
        source = FIXTURES / 'representative' / 'representative-two-page.pdf'
        with tempfile.TemporaryDirectory() as td:
            output = Path(td) / 'translated.pdf'
            report = translate_document(source, output, translator=lambda req: '中文 ' + req.text)
            self.assertEqual(report['pages'], 2)
            self.assertLess(output.stat().st_size, 1_000_000)
            with fitz.open(source) as original, fitz.open(output) as translated:
                self.assertEqual(len(original), len(translated))
                for a, b in zip(original, translated):
                    self.assertEqual(a.rect, b.rect)
                    self.assertEqual(a.rotation, b.rotation)
                    self.assertEqual(len(a.get_drawings()), len(b.get_drawings()))
                    self.assertEqual([x.get('uri') for x in a.get_links()],
                                     [x.get('uri') for x in b.get_links()])
                    self.assertEqual([original.extract_image(x[0])['image'] for x in a.get_images()],
                                     [translated.extract_image(x[0])['image'] for x in b.get_images()])
                    self.assertIn('中文', b.get_text())

    def test_word_nested_paragraph_links_and_dynamic_field(self):
        from lxml import etree as LXML
        w = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        r = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'semantic.docx'
            with ZipFile(FIXTURES / 'sample.docx') as original, ZipFile(src, 'w') as modified:
                for info in original.infolist():
                    payload = original.read(info.filename)
                    if info.filename == 'word/document.xml':
                        root = LXML.fromstring(payload)
                        body = root.find(w + 'body')
                        outer = LXML.SubElement(body, w + 'p')
                        LXML.SubElement(LXML.SubElement(outer, w + 'r'), w + 't').text = 'Outer'
                        inner = LXML.SubElement(LXML.SubElement(outer, w + 'txbxContent'), w + 'p')
                        LXML.SubElement(LXML.SubElement(inner, w + 'r'), w + 't').text = 'Inner'
                        links = LXML.SubElement(body, w + 'p')
                        for rel, label in [('rIdPrivacy', 'Privacy'), ('rIdTerms', 'Terms')]:
                            link = LXML.SubElement(links, w + 'hyperlink', {r + 'id': rel})
                            LXML.SubElement(LXML.SubElement(link, w + 'r'), w + 't').text = label
                        field = LXML.SubElement(body, w + 'p')
                        LXML.SubElement(LXML.SubElement(field, w + 'r'), w + 'fldChar', {w + 'fldCharType': 'begin'})
                        LXML.SubElement(LXML.SubElement(field, w + 'r'), w + 'instrText').text = 'DATE'
                        result_para = LXML.SubElement(body, w + 'p')
                        LXML.SubElement(LXML.SubElement(result_para, w + 'r'), w + 'fldChar', {w + 'fldCharType': 'separate'})
                        LXML.SubElement(LXML.SubElement(result_para, w + 'r'), w + 't').text = 'Dynamic result'
                        end_para = LXML.SubElement(body, w + 'p')
                        LXML.SubElement(LXML.SubElement(end_para, w + 'r'), w + 'fldChar', {w + 'fldCharType': 'end'})
                        payload = LXML.tostring(root, encoding='UTF-8', xml_declaration=True)
                    modified.writestr(info, payload)
            seen = []
            mapping = {'Outer': '外部', 'Inner': '内部', 'Privacy': '隐私', 'Terms': '条款'}
            report = translate_document(src, translator=lambda req: seen.append(req.text) or mapping.get(req.text, req.text))
            self.assertEqual(seen.count('Outer'), 1)
            self.assertEqual(seen.count('Inner'), 1)
            self.assertEqual(seen.count('Privacy'), 1)
            self.assertEqual(seen.count('Terms'), 1)
            self.assertNotIn('Dynamic result', seen)
            with ZipFile(report['output']) as z:
                root = LXML.fromstring(z.read('word/document.xml'))
                labels = {link.get(r + 'id'): ''.join(link.itertext()) for link in root.iter(w + 'hyperlink')}
                self.assertEqual(labels, {'rIdPrivacy': '隐私', 'rIdTerms': '条款'})
                self.assertIn('Dynamic result', ''.join(root.itertext()))

    def test_pptx_link_labels_and_dynamic_field(self):
        from lxml import etree as LXML
        a = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
        r = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'semantic.pptx'
            with ZipFile(FIXTURES / 'sample.pptx') as original, ZipFile(src, 'w') as modified:
                for info in original.infolist():
                    payload = original.read(info.filename)
                    if info.filename == 'ppt/slides/slide1.xml':
                        root = LXML.fromstring(payload)
                        para = next(root.iter(a + 'p'))
                        for rel, label in [('rIdPrivacy', 'Privacy'), ('rIdTerms', 'Terms')]:
                            run = LXML.SubElement(para, a + 'r')
                            props = LXML.SubElement(run, a + 'rPr')
                            LXML.SubElement(props, a + 'hlinkClick', {r + 'id': rel})
                            LXML.SubElement(run, a + 't').text = label
                        field = LXML.SubElement(para, a + 'fld', {'id': '{00000000-0000-0000-0000-000000000000}', 'type': 'slidenum'})
                        LXML.SubElement(field, a + 't').text = 'Slide 1'
                        payload = LXML.tostring(root, encoding='UTF-8', xml_declaration=True)
                    modified.writestr(info, payload)
            seen = []
            mapping = {'Privacy': '隐私', 'Terms': '条款', 'Hello': '你好'}
            report = translate_document(src, translator=lambda req: seen.append(req.text) or mapping.get(req.text, req.text))
            self.assertEqual(seen, ['Hello', 'Privacy', 'Terms'])
            with ZipFile(report['output']) as z:
                root = LXML.fromstring(z.read('ppt/slides/slide1.xml'))
                labels = {}
                for run in root.iter(a + 'r'):
                    click = run.find('.//' + a + 'hlinkClick')
                    value = run.find(a + 't')
                    if click is not None:
                        labels[click.get(r + 'id')] = value.text
                self.assertEqual(labels, {'rIdPrivacy': '隐私', 'rIdTerms': '条款'})
                self.assertIn('Slide 1', ''.join(root.itertext()))

    def test_pdf_rotated_and_image_only(self):
        import pymupdf as fitz
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'rotated.pdf'
            with fitz.open(FIXTURES / 'sample.pdf') as pdf:
                pdf[0].set_rotation(90)
                pdf.save(src)
            report = translate_document(src, translator=lambda req: '你好世界' if req.text == 'Hello world' else req.text)
            with fitz.open(report['output']) as pdf:
                self.assertEqual(pdf[0].rotation, 90)
                self.assertIn('你好世界', pdf[0].get_text())
            scanned = Path(td) / 'scanned.pdf'
            with fitz.open() as pdf:
                page = pdf.new_page()
                page.insert_image(fitz.Rect(20, 20, 100, 100), filename=str(FIXTURES / 'green-square.png'))
                pdf.save(scanned)
            with self.assertRaisesRegex(TranslationError, 'no extractable text'):
                translate_document(scanned, translator=lambda req: 'x')
            self.assertFalse(scanned.with_name('scanned.translated.pdf').exists())

    def test_known_temporary_path(self):
        with tempfile.TemporaryDirectory() as td:
            src = Path(td) / 'sample.docx'
            src.write_bytes((FIXTURES / 'sample.docx').read_bytes())
            known = Path(td) / f'.OpenDeepL-{uuid.uuid4()}.tmp'
            observed = []
            def stub(req):
                observed.append((known.exists(), known.stat().st_mode & 0o777))
                return req.text
            translate_document(src, temporary_path=known, translator=stub)
            self.assertTrue(observed[0][0])
            if os.name != 'nt':
                self.assertEqual(observed[0][1], 0o600)
            self.assertFalse(known.exists())
            with self.assertRaisesRegex(TranslationError, 'Invalid document temporary'):
                translate_document(src, Path(td) / 'another.docx', temporary_path=Path(td) / 'bad.tmp', translator=stub)


if __name__ == '__main__':
    unittest.main()
