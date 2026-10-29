"""Conservative, locally rendered PDF text replacement (pypdf + PDFium + ReportLab).

Simple horizontal text objects with Unicode mappings are supported. A page is fully
preflighted before any model call. Unsupported layout is reported rather than
silently dropping text. Original text objects are removed from content streams,
not covered by an opaque rectangle; non-text operators and page objects remain.
"""
from __future__ import annotations

from io import BytesIO
from contextlib import closing
import ctypes
import math
import os
from pathlib import Path

from .open_deepl_core import TranslationError


def _font_path():
    supplied = os.environ.get('OPENDEEPL_PDF_FONT')
    candidates = [Path(supplied)] if supplied else []
    candidates += [Path(__file__).resolve().parents[1] / 'resources/fonts/NotoSansSC-Regular.ttf',
                   Path('/Library/Fonts/Arial Unicode.ttf')]
    for path in candidates:
        if path.is_file() and path.suffix.lower() == '.ttf':
            return path
    raise TranslationError('A local CJK TrueType font is required for PDF translation.')


def _near(a, b):
    return math.isclose(float(a), float(b), abs_tol=0.0001)


def _bbox_intersects(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _resolved(obj):
    return obj.get_object() if hasattr(obj, 'get_object') else obj


def _compose(m, n):
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (a*A+c*B, b*A+d*B, a*C+c*D, b*C+d*D,
            a*E+c*F+e, b*E+d*F+f)


def _page_plan(page, reader, page_number, pdfium_page):
    from pypdf.generic import ContentStream
    import pypdfium2 as pdfium

    def unsupported():
        raise TranslationError(f'Unsupported PDF text layout or encoding on page {page_number}.')

    if int(page.get('/Rotate', 0)) % 360:
        raise TranslationError(f'Rotated PDF text needs manual layout on page {page_number}.')
    crop = page.cropbox
    if not _near(crop.left, 0) or not _near(crop.bottom, 0):
        unsupported()
    width, height = float(crop.width), float(crop.height)
    resources = _resolved(page.get('/Resources', {}))
    for xobject in _resolved(resources.get('/XObject', {})).values():
        # Text inside a Form XObject could otherwise survive the rewrite.
        if xobject.get_object().get('/Subtype') == '/Form':
            unsupported()
    fonts = _resolved(resources.get('/Font', {}))
    contents = page.get_contents()
    operations = ContentStream(contents, reader).operations if contents is not None else []
    blocks = []
    inside = False
    start = -1
    for index, (args, op) in enumerate(operations):
        if op == b'BT':
            if inside:
                unsupported()
            start, inside = index, True
        elif op == b'ET':
            if not inside:
                unsupported()
            blocks.append((start, index, operations[start:index + 1]))
            inside = False
    if inside:
        unsupported()

    image_boxes = []
    start_colors = {}
    matrix = (1., 0., 0., 1., 0., 0.)
    fill = (0., 0., 0.)
    stack = []
    for index, (args, op) in enumerate(operations):
        if op == b'q':
            stack.append((matrix, fill))
        elif op == b'Q':
            if not stack:
                unsupported()
            matrix, fill = stack.pop()
        elif op == b'cm':
            matrix = _compose(matrix, tuple(float(v) for v in args))
        elif op == b'rg':
            fill = tuple(float(v) for v in args)
        elif op == b'g':
            fill = (float(args[0]),) * 3
        elif op in (b'k', b'sc', b'scn'):
            fill = None
        elif op == b'BT':
            start_colors[index] = fill
        elif op == b'Do':
            xobject = _resolved(_resolved(resources.get('/XObject', {})).get(args[0]))
            if xobject is not None and xobject.get('/Subtype') == '/Image':
                a, b, c, d, e, f = matrix
                corners = [(e, f), (a+e, b+f), (c+e, d+f), (a+c+e, b+d+f)]
                image_boxes.append((min(x for x, _ in corners), min(y for _, y in corners),
                                    max(x for x, _ in corners), max(y for _, y in corners)))

    shows_per_block = []
    for start, end, chunk in blocks:
        shows_per_block.append(sum(op in (b'Tj', b'TJ', b"'", b'"') for _, op in chunk))
    text_objects = [item for item in pdfium_page.get_objects() if item.type == 1]
    if not text_objects:
        if any(shows_per_block) or operations:
            raise TranslationError(f'PDF page {page_number} has no extractable text layer.')
        return operations, []
    if len(text_objects) != sum(shows_per_block):
        unsupported()
    # PDFium maps decoded Unicode glyphs to their actual page text objects.
    # A one-to-one match with the stream's show operators is mandatory; this
    # prevents a partial removal of visible or copyable source text.
    object_ids = {ctypes.cast(obj.raw, ctypes.c_void_p).value: index
                  for index, obj in enumerate(text_objects)}
    object_texts = ['' for _ in text_objects]
    textpage = pdfium_page.get_textpage()
    for index in range(textpage.count_chars()):
        textobj = textpage.get_textobj(index)
        if textobj is None:
            continue  # PDFium's synthetic line breaks are not in source runs.
        oid = object_ids.get(ctypes.cast(textobj.raw, ctypes.c_void_p).value)
        if oid is None:
            unsupported()
        codepoint = pdfium.raw.FPDFText_GetUnicode(textpage.raw, index)
        if (not codepoint or codepoint == 0xfffd or
                0xd800 <= codepoint <= 0xdfff or codepoint > 0x10ffff):
            unsupported()
        object_texts[oid] += chr(codepoint)
    if any(not value.strip() for value in object_texts):
        unsupported()
    plan = []
    object_cursor = 0
    for ordinal, (start, end, chunk) in enumerate(blocks, 1):
        shows = [op for _, op in chunk if op in (b'Tj', b'TJ', b"'", b'"')]
        if not shows:
            continue
        if any(op not in (b'Tj', b'TJ') for op in shows):
            unsupported()
        allowed = {b'BT', b'ET', b'Tm', b'Tf', b'Tj', b'TJ', b'rg', b'g', b'RG', b'G', b'TL', b'T*'}
        if any(op not in allowed for _, op in chunk):
            unsupported()
        # ReportLab emits a trailing T* after the sole show. A line break
        # before another show would require multiple replacement baselines.
        show_indexes = [i for i, (_, op) in enumerate(chunk) if op in (b'Tj', b'TJ')]
        if any(op == b'T*' and i < show_indexes[-1] for i, (_, op) in enumerate(chunk)):
            unsupported()
        tm_ops = [args for args, op in chunk if op == b'Tm']
        tf_ops = [args for args, op in chunk if op == b'Tf']
        if len(tm_ops) != 1 or len(tf_ops) != 1:
            unsupported()
        segment_objects = text_objects[object_cursor:object_cursor + len(shows)]
        text = ''.join(object_texts[object_cursor:object_cursor + len(shows)])
        object_cursor += len(shows)
        if not text.strip() or any(ord(ch) < 32 for ch in text):
            unsupported()
        size = float(tf_ops[0][1])
        tm = tm_ops[0]
        if not all(_near(v, expected) for v, expected in zip(tm[:4], (1, 0, 0, 1))):
            raise TranslationError(f'Rotated PDF text needs manual layout on page {page_number}.')
        key = tf_ops[0][0]
        font_obj = fonts.get(key)
        if font_obj is None:
            unsupported()
        font_obj = _resolved(font_obj)
        subtype = font_obj.get('/Subtype')
        encoding = font_obj.get('/Encoding')
        if subtype not in ('/Type0', '/TrueType', '/Type1'):
            unsupported()
        if subtype in ('/Type0', '/TrueType') and not font_obj.get('/ToUnicode'):
            unsupported()
        if subtype == '/Type1' and not font_obj.get('/ToUnicode') and encoding not in (
                None, '/WinAnsiEncoding', '/StandardEncoding', '/MacRomanEncoding'):
            unsupported()
        if size < 5:
            unsupported()
        matrices = [obj.get_matrix() for obj in segment_objects]
        if any(not all(_near(getattr(matrix, attribute), expected)
                           for attribute, expected in zip(('a', 'b', 'c', 'd'), (1, 0, 0, 1)))
               for matrix in matrices):
            raise TranslationError(f'Rotated PDF text needs manual layout on page {page_number}.')
        if any(not _near(obj.get_font_size(), size) or
               not _near(matrix.f, matrices[0].f)
               for obj, matrix in zip(segment_objects, matrices)):
            unsupported()
        x, y = float(matrices[0].e), float(matrices[0].f)
        bounds = [obj.get_bounds() for obj in segment_objects]
        if any(bounds[i+1][0] < bounds[i][0] - 0.5 or
               bounds[i+1][0] - bounds[i][2] > size * 1.5
               for i in range(len(bounds)-1)):
            unsupported()
        right = max(rect[2] for rect in bounds)
        # PDFium's glyph bounds work for CID/embedded TrueType fonts too.
        # The original line's occupied horizontal extent is the fit region.
        box = (x, y - size * .25, max(right, x + 3), y + size * .85)
        if not (0 <= box[0] < box[2] <= width and 0 <= box[1] < box[3] <= height):
            unsupported()
        color = start_colors[start]
        if color is None:
            unsupported()
        # This strict subset accepts per-object RGB/gray only. External graphics
        # state color changes are rejected instead of inserting wrong colors.
        for args, op in chunk:
            if op == b'rg':
                color = tuple(float(v) for v in args)
            elif op == b'g':
                color = (float(args[0]),) * 3
        if len(color) != 3 or any(not 0 <= c <= 1 for c in color):
            unsupported()
        plan.append({'start': start, 'end': end, 'text': text, 'box': box,
                     'size': float(size), 'color': color,
                     'location': f'page{page_number}:span{ordinal}'})
    # Reject text sitting on interactive annotations. Rewriting their labels
    # could obscure destinations or annotation appearances.
    for entry in plan:
        if any(_bbox_intersects(entry['box'], box) for box in image_boxes):
            raise TranslationError(f"PDF text overlaps protected artwork or annotation at {entry['location']}.")
        for annotation in _resolved(page.get('/Annots', [])):
            rect = annotation.get_object().get('/Rect')
            if rect and _bbox_intersects(entry['box'], tuple(map(float, rect))):
                raise TranslationError(f"PDF text overlaps protected artwork or annotation at {entry['location']}.")
    return operations, plan


def translate_pdf(source, output, base, translator, report, progress, translate_text):
    try:
        import pypdfium2 as pdfium
        from pypdf import PdfReader, PdfWriter
        from pypdf.errors import PdfReadError
        from pypdf.generic import ContentStream, DecodedStreamObject
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen import canvas
    except ImportError as exc:
        raise TranslationError('PDF runtime requires pypdf and ReportLab.') from exc

    font_path = _font_path()
    try:
        reader = PdfReader(str(source), strict=True)
        if reader.is_encrypted:
            raise TranslationError('Encrypted PDF is not supported.')
        root = reader.trailer['/Root']
        if root.get('/Perms') or root.get('/AcroForm'):
            raise TranslationError('Signed or form PDF is not supported.')
        total = len(reader.pages)
        report['pages'] = total
        plans = []
        with pdfium.PdfDocument(str(source)) as rendered:
            for number, page in enumerate(reader.pages, 1):
                progress({'phase': 'validating', 'completed': number - 1,
                          'total': total, 'part': f'page{number}'})
                with closing(rendered[number - 1]) as rendered_page:
                    plans.append(_page_plan(page, reader, number, rendered_page))
        if not any(entries for _, entries in plans):
            raise TranslationError('PDF has no extractable text layer.')
        pdfmetrics.registerFont(TTFont('OpenDeepLCJK', str(font_path)))
        writer = PdfWriter(clone_from=reader)
        for number, (operations, entries) in enumerate(plans, 1):
            progress({'phase': 'translating', 'completed': number - 1,
                      'total': total, 'part': f'page{number}'})
            page = writer.pages[number - 1]
            replacements = []
            for entry in entries:
                location = entry['location']
                progress({'phase': 'translating', 'completed': number - 1,
                          'total': total, 'part': location})
                target = translate_text(entry['text'], base, translator, report, location)
                if target == entry['text']:
                    continue
                # This backend replaces a run in its original one-line region.
                # Wrapping over neighbouring artwork/text is never automatic.
                fit_size = None
                for tenth in range(round(entry['size'] * 10), 49, -1):
                    candidate = tenth / 10
                    if pdfmetrics.stringWidth(target, 'OpenDeepLCJK', candidate) <= entry['box'][2] - entry['box'][0]:
                        fit_size = candidate
                        break
                if fit_size is None or '\n' in target or '\r' in target:
                    report['overflow'].append({'location': location, 'box': list(entry['box']),
                                               'textLength': len(target)})
                    raise TranslationError(f'PDF translated text overflow on page {number}.')
                replacements.append((entry, target, fit_size))
            if replacements:
                removed = {index for entry, _, _ in replacements
                           for index in range(entry['start'], entry['end'] + 1)}
                stream = ContentStream(None, writer)
                stream.operations = [op for index, op in enumerate(operations) if index not in removed]
                new_content = DecodedStreamObject()
                new_content.set_data(stream.get_data())
                page.replace_contents(new_content)
                packet = BytesIO()
                overlay = canvas.Canvas(packet, pagesize=(float(page.mediabox.width), float(page.mediabox.height)),
                                        pageCompression=1)
                for entry, target, size in replacements:
                    x, y = entry['box'][0], entry['box'][1] + entry['size'] * .25
                    overlay.setFillColorRGB(*entry['color'])
                    overlay.setFont('OpenDeepLCJK', size)
                    overlay.drawString(x, y, target)
                    report['translatedSegments'] += 1
                overlay.save()
                packet.seek(0)
                page.merge_page(PdfReader(packet).pages[0])
            progress({'phase': 'translating', 'completed': number, 'total': total,
                      'part': f'page{number}'})
        progress({'phase': 'assembling', 'completed': total, 'total': total, 'part': 'output'})
        # clone_from initially imports original content streams too. Drop every
        # now-unreachable object so removed source text is absent from the file,
        # not merely hidden from normal extraction.
        writer.compress_identical_objects(remove_duplicates=False, remove_unreferenced=True)
        with open(output, 'wb') as dest:
            writer.write(dest)
    except (PdfReadError, ValueError, KeyError, IndexError, TypeError) as exc:
        raise TranslationError('Invalid or damaged PDF document.') from exc
