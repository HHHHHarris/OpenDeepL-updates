"""Offline document translation that keeps package parts and PDF page artwork intact.

No document bytes are sent anywhere except to the injected local engine.
"""
from __future__ import annotations

from dataclasses import replace
import os
import posixpath
from pathlib import Path
import re
import tempfile
import uuid
from typing import Callable
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZipFile

from .open_deepl_core import (DualModelEngine, MODEL_ALIASES, TranslationError,
                              TranslationRequest, LocalEngineError)

_W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
_A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
_TOKEN = re.compile(r'(\{\{[^{}]+\}\}|\$\{[^{}]+\}|<[A-Z][A-Z0-9_]*>|https?://\S+|\b(?:PASS|FAIL)\b|\b[A-Z]{2,}\d{2,}\b|\b\d+(?:[.,:/-]\d+)*%?\b)')
_MAX_CHARS = 1200


def _request(value):
    if value is None:
        return TranslationRequest(text='')
    if isinstance(value, TranslationRequest):
        if value.modelMode not in MODEL_ALIASES:
            raise TranslationError('Unknown local model mode.')
        return value
    if isinstance(value, dict):
        return _request(TranslationRequest.from_dict({'text': '', **value}))
    raise TranslationError('Invalid document translation options.')


def _engine_call(translator, req):
    return translator(req) if callable(translator) else translator.translate(req)


def _split(text, limit=_MAX_CHARS):
    """Split before model context limit; never drop whitespace between pieces."""
    result = []
    while len(text) > limit:
        cut = max(text.rfind(x, 0, limit + 1) for x in ('。', '.', '！', '!', '？', '?', '\n', ' '))
        if cut < limit // 3:
            cut = limit
        else:
            cut += 1
        result.append(text[:cut])
        text = text[cut:]
    if text:
        result.append(text)
    return result


def _translate(text, base, translator, report, location):
    if not text.strip() or not any(ch.isalpha() for ch in text):
        return text
    prefix = text[:len(text) - len(text.lstrip())]
    suffix = text[len(text.rstrip()):]
    body = text[len(prefix):len(text) - len(suffix) if suffix else len(text)]
    pieces = []
    for chunk in _split(body):
        protected = []
        marker_prefix = 'OD'
        while re.search(re.escape(marker_prefix) + r'\d{3,}', chunk):
            marker_prefix += 'Z'
        def substitute(match):
            marker = f'⟦{marker_prefix}{len(protected):03d}⟧'
            protected.append((marker, match.group()))
            return marker
        source = _TOKEN.sub(substitute, chunk)
        # Protocol-only paragraphs (PASS, <SKU_ID>, URLs, amounts, etc.) are
        # already exact. They need neither inference nor an untranslated warning.
        unprotected = re.sub('⟦' + re.escape(marker_prefix) + r'\d{3,}⟧', '', source)
        if not any(ch.isalpha() for ch in unprotected):
            pieces.append(chunk)
            continue
        req = replace(base, text=source)
        try:
            translated = _engine_call(translator, req)
        except LocalEngineError as exc:
            # At most one transient retry for the entire document. A document
            # chunk is buffered until complete, so retries cannot duplicate text
            # or publish a partial output. Text-mode streaming never retries.
            if not exc.retryable or report.get('engineRetries', 0) >= 1:
                raise
            report['engineRetries'] = report.get('engineRetries', 0) + 1
            translated = _engine_call(translator, req)
        if not isinstance(translated, str) or not translated.strip():
            raise TranslationError(f'Empty translation at {location}.')
        # Some translation models change only Unicode bracket glyphs. Repair
        # known IDs, not numbers or translated words, then validate every ID.
        for marker, _ in protected:
            identifier = marker[1:-1]
            variants = re.compile(r'(?:⟨|〈|《|【|\[|<)\s*' + re.escape(identifier) + r'\s*(?:⟩|〉|》|】|\]|>)')
            translated, repairs = variants.subn(marker, translated)
            if repairs:
                report.setdefault('markerRepairs', []).append({'location': location, 'count': repairs})
        expected = {marker: original for marker, original in protected}
        for marker in expected:
            if translated.count(marker) != 1:
                raise TranslationError(f'Placeholder mismatch at {location}.')
        marker_pattern = re.compile('⟦' + re.escape(marker_prefix) + r'\d{3,}⟧')
        if any(marker not in expected for marker in marker_pattern.findall(translated)):
            raise TranslationError(f'Placeholder mismatch at {location}.')
        # One pass avoids treating a restored user value as another placeholder.
        translated = marker_pattern.sub(lambda match: expected[match.group()], translated)
        if translated == chunk and location not in report['unresolved']:
            report['unresolved'].append(location)
        pieces.append(translated)
    return prefix + ''.join(pieces) + suffix


def _distribute(nodes, old_texts, translated):
    """Keep every original run/shape node and its styling; allocate new text stably."""
    if len(nodes) == 1:
        nodes[0].text = translated
        return
    weights = [len(s) for s in old_texts]
    total = sum(weights)
    boundaries = [0]
    sofar = 0
    for weight in weights[:-1]:
        sofar += weight
        boundaries.append(round(len(translated) * sofar / total))
    boundaries.append(len(translated))
    for index, node in enumerate(nodes):
        node.text = translated[boundaries[index]:boundaries[index + 1]]


def _xml_member(name, kind):
    if kind == '.docx':
        return bool(re.fullmatch(r'word/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml', name))
    return bool(re.fullmatch(r'ppt/(slides/slide\d+|notesSlides/notesSlide\d+)\.xml', name))


def _paragraph_groups(para, kind, field_state=None):
    """Collect each text node only in its nearest paragraph and link/field scope.

    A linked label must be translated as its own semantic unit. Field results and
    instructions are dynamic content, so neither they nor text across them is
    passed to the model.
    """
    text_tag = _W + 't' if kind == '.docx' else _A + 't'
    paragraph_tag = _W + 'p' if kind == '.docx' else _A + 'p'
    if kind == '.pptx':
        groups = []
        active = []
        active_link = None
        for node in para.iter(text_tag):
            if not node.text or next((p for p in node.iterancestors() if p.tag == paragraph_tag), None) is not para:
                continue
            if any(p.tag == _A + 'fld' for p in node.iterancestors()):
                if active:
                    groups.append(active)
                    active = []
                active_link = None
                continue
            run = next((p for p in node.iterancestors() if p.tag == _A + 'r'), None)
            click = run.find('.//' + _A + 'hlinkClick') if run is not None else None
            link = (click.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'),
                    click.get('action')) if click is not None else None
            if active and link != active_link:
                groups.append(active)
                active = []
            active_link = link
            active.append(node)
        if active:
            groups.append(active)
        return groups
    groups = []
    active = []
    active_link = None
    field_depth = field_state[0] if field_state is not None else 0

    def flush():
        nonlocal active, active_link
        if active:
            groups.append(active)
            active = []
        active_link = None

    def visit(node, link=None, protected=False):
        nonlocal field_depth, active_link
        if node is not para and node.tag == paragraph_tag:
            return  # text-box paragraph: its own later pass, never the outer one
        if node.tag in (_W + 'fldSimple', _W + 'sdt', _W + 'del'):
            flush()
            protected = True
        if node.tag == _W + 'hyperlink':
            link = node
        if node.tag == _W + 'fldChar':
            flush()
            field_type = node.get(_W + 'fldCharType')
            if field_type == 'begin':
                field_depth += 1
            elif field_type == 'end':
                field_depth = max(0, field_depth - 1)
        if node.tag in (_W + 'instrText', _W + 'delText'):
            flush()
        if node.tag == text_tag and node.text:
            if protected or field_depth:
                flush()
            else:
                if active and active_link is not link:
                    flush()
                active_link = link
                active.append(node)
        for child in node:
            visit(child, link, protected)
    visit(para)
    flush()
    if field_state is not None:
        field_state[0] = field_depth
    return groups


def _validate_ooxml(package, kind, ET):
    """Check the OPC graph before invoking the model, not only ZIP readability."""
    names = package.namelist()
    members = set(names)
    rel_ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    ct_ns = '{http://schemas.openxmlformats.org/package/2006/content-types}'
    main = 'word/document.xml' if kind == '.docx' else 'ppt/presentation.xml'
    main_type = ('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
                 if kind == '.docx' else
                 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')

    def invalid():
        raise TranslationError('Invalid or damaged document package.')

    def xml(name, tag=None):
        if name not in members or package.getinfo(name).file_size > 32_000_000:
            invalid()
        try:
            root = ET.fromstring(package.read(name), parser=ET.XMLParser(resolve_entities=False, no_network=True))
        except ET.ParseError:
            invalid()
        if (tag is not None and root.tag != tag) or root.getroottree().docinfo.doctype:
            invalid()
        return root

    def part(target, owner=''):
        uri = urlsplit(target)
        if uri.scheme or uri.netloc or uri.query:
            invalid()
        path = unquote(uri.path)
        resolved = posixpath.normpath(path.lstrip('/') if path.startswith('/') else
                                      posixpath.join(posixpath.dirname(owner), path))
        if '\\' in resolved or resolved in ('', '.', '..') or resolved.startswith('../'):
            invalid()
        return resolved

    if len(names) != len(members) or main not in members or '_rels/.rels' not in members:
        invalid()
    if any(info.flag_bits & 1 for info in package.infolist()):
        raise TranslationError('Encrypted document package is not supported.')
    # A late header, style part, or damaged media member must fail before the
    # first model request, not after a potentially long translation of the body.
    if package.testzip() is not None:
        invalid()
    for name in names:
        if name.lower().endswith('.xml'):
            xml(name)
    types = xml('[Content_Types].xml', ct_ns + 'Types')
    overrides = {}
    for item in types.findall(ct_ns + 'Override'):
        target = part(item.get('PartName', ''))
        if target not in members or target in overrides:
            invalid()
        overrides[target] = item.get('ContentType')
    if overrides.get(main) != main_type:
        invalid()
    root_main = xml(main, _W + 'document' if kind == '.docx' else
                    '{http://schemas.openxmlformats.org/presentationml/2006/main}presentation')
    if kind == '.docx' and root_main.find(_W + 'body') is None:
        invalid()
    root_office_targets = []
    for name in names:
        if not name.endswith('.rels'):
            continue
        if name == '_rels/.rels':
            owner = ''
        else:
            folder, leaf = posixpath.split(name)
            if posixpath.basename(folder) != '_rels':
                invalid()
            owner = posixpath.join(posixpath.dirname(folder), leaf[:-5])
            if owner not in members:
                invalid()
        relationships = xml(name, rel_ns + 'Relationships')
        ids = set()
        for relationship in relationships:
            if not isinstance(relationship.tag, str):
                continue  # XML comments and processing instructions are not edges.
            rid, target = relationship.get('Id'), relationship.get('Target')
            if relationship.tag != rel_ns + 'Relationship' or not rid or rid in ids or not target:
                invalid()
            ids.add(rid)
            if relationship.get('TargetMode') == 'External':
                continue  # Retain external links; never fetch them.
            resolved = part(target, owner)
            if resolved not in members:
                invalid()
            if name == '_rels/.rels' and relationship.get('Type') == (
                    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument'):
                root_office_targets.append(resolved)
    if root_office_targets != [main]:
        invalid()


def _translate_ooxml(source, output, base, translator, report, progress):
    try:
        from lxml import etree as ET
    except ImportError as exc:
        raise TranslationError('lxml is required in the private document runtime.') from exc
    kind = source.suffix.lower()
    with ZipFile(source, 'r') as package:
        if sum(info.file_size for info in package.infolist()) > 500_000_000:
            raise TranslationError('Expanded document package exceeds the local limit.')
        names = package.namelist()
        _validate_ooxml(package, kind, ET)
        targets = [n for n in names if _xml_member(n, kind)]
        changed = {}
        total = len(targets)
        for part_number, name in enumerate(targets, 1):
            progress({'phase': 'translating', 'completed': part_number - 1, 'total': total, 'part': name})
            payload = package.read(name)
            if len(payload) > 32_000_000:
                raise TranslationError('Document XML exceeds the local limit.')
            try:
                root = ET.fromstring(payload, parser=ET.XMLParser(resolve_entities=False, no_network=True))
            except ET.ParseError as exc:
                raise TranslationError(f'Invalid document XML: {name}.') from exc
            paragraph_tag = _W + 'p' if kind == '.docx' else _A + 'p'
            dirty = False
            field_state = [0]
            groups = [(para_index, group_index, nodes)
                      for para_index, para in enumerate(root.iter(paragraph_tag), 1)
                      for group_index, nodes in enumerate(_paragraph_groups(para, kind, field_state), 1) if nodes]
            for segment_index, (para_index, group_index, nodes) in enumerate(groups, 1):
                if not nodes:
                    continue
                originals = [node.text or '' for node in nodes]
                original = ''.join(originals)
                location = f'{name}:p{para_index}:g{group_index}'
                progress({'phase': 'translating', 'completed': part_number - 1,
                          'total': total, 'part': location,
                          'segmentsCompleted': segment_index - 1, 'segmentsTotal': len(groups)})
                translated = _translate(original, base, translator, report, location)
                if translated != original:
                    _distribute(nodes, originals, translated)
                    for node in nodes:
                        if node.text and (node.text[0].isspace() or node.text[-1].isspace()):
                            node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
                    report['translatedSegments'] += 1
                    dirty = True
                progress({'phase': 'translating', 'completed': part_number - 1,
                          'total': total, 'part': location,
                          'segmentsCompleted': segment_index, 'segmentsTotal': len(groups)})
            if dirty:
                changed[name] = ET.tostring(root, encoding='UTF-8', xml_declaration=True, standalone=True)
            progress({'phase': 'translating', 'completed': part_number, 'total': total, 'part': name})
        progress({'phase': 'assembling', 'completed': total, 'total': total, 'part': 'output'})
        with ZipFile(output, 'w') as result:
            for info in package.infolist():
                result.writestr(info, changed.get(info.filename, package.read(info.filename)))
    report['changedParts'] = sorted(changed)
    report['preservedParts'] = len(names) - len(changed)


def _translate_pdf(source, output, base, translator, report, progress):
    from .pdf_backend import translate_pdf
    translate_pdf(source, output, base, translator, report, progress, _translate)


def translate_document(input_path, output_path=None, request=None, on_progress=None,
                       translator=None, temporary_path=None):
    """Translate DOCX, PPTX or PDF and return a structural/overflow report.

    `output_path` defaults to a sibling `.translated` file. Existing destinations
    are rejected, and publication is atomic after a complete successful translation.
    The optional `translator` accepts TranslationRequest and returns text, allowing
    deterministic tests; otherwise the local OfflineEngine is used.
    """
    source = Path(input_path).expanduser().resolve(strict=True)
    kind = source.suffix.lower()
    if kind not in ('.docx', '.pptx', '.pdf') or not source.is_file():
        raise TranslationError('Supported document types: DOCX, PPTX, PDF.')
    destination = (Path(output_path).expanduser() if output_path else
                   source.with_name(source.stem + '.translated' + source.suffix))
    destination = destination.absolute()
    if destination == source or destination.exists() or destination.is_symlink():
        raise TranslationError('Output must be a new file distinct from the source.')
    if not destination.parent.is_dir():
        raise TranslationError('Output directory does not exist.')
    base = _request(request)
    translator = DualModelEngine() if translator is None else translator
    progress = on_progress or (lambda event: None)
    report = {'input': str(source), 'output': str(destination), 'format': kind[1:],
              'modelMode': base.modelMode, 'modelId': MODEL_ALIASES[base.modelMode],
              'translatedSegments': 0, 'changedParts': [], 'preservedParts': 0,
              'pages': 0, 'unresolved': [], 'overflow': []}
    if temporary_path is None:
        fd, temporary = tempfile.mkstemp(prefix='.' + destination.name + '-', suffix='.tmp', dir=destination.parent)
    else:
        temporary = Path(temporary_path).expanduser().absolute()
        match = re.fullmatch(r'\.OpenDeepL-([0-9a-fA-F-]{36})\.tmp', temporary.name)
        try:
            valid_uuid = bool(match and str(uuid.UUID(match.group(1))) == match.group(1).lower())
        except ValueError:
            valid_uuid = False
        if not valid_uuid:
            raise TranslationError('Invalid document temporary file name.')
        if temporary.parent.resolve() != destination.parent.resolve() or temporary.is_symlink():
            raise TranslationError('Document temporary file must be beside the output.')
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as exc:
            raise TranslationError('Document temporary file already exists.') from exc
    os.close(fd)
    try:
        progress({'phase': 'validating', 'completed': 0, 'total': 1, 'part': kind[1:].upper()})
        try:
            if kind == '.pdf':
                _translate_pdf(source, temporary, base, translator, report, progress)
            else:
                _translate_ooxml(source, temporary, base, translator, report, progress)
        except BadZipFile as exc:
            # A corrupt OOXML archive can fail on open or on a later member CRC.
            # Keep this inside the document protocol's expected error boundary.
            raise TranslationError('Invalid or damaged document package.') from exc
        # Same-directory hard link publishes the finished file atomically and fails
        # if a competing process created the destination in the meantime.
        os.link(temporary, destination)
        progress({'phase': 'complete', 'completed': 1, 'total': 1, 'part': str(destination)})
        return report
    finally:
        Path(temporary).unlink(missing_ok=True)
