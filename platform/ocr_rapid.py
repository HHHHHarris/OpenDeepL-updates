#!/usr/bin/env python3
"""One-shot, local RapidOCR helper. Input: image path; output: one JSON object."""
import hashlib
import json
from pathlib import Path
import socket
import sys

ENGINE = 'rapidocr-onnxruntime/1.4.4-cpu'
MODEL_SHA256 = {
    'ch_PP-OCRv4_det_infer.onnx': 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9',
    'ch_PP-OCRv4_rec_infer.onnx': '48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b',
    'ch_ppocr_mobile_v2.0_cls_infer.onnx': 'e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c',
}


def verify_models(package_dir):
    """Fail closed if bundled weights are absent or differ from inspected wheel."""
    model_dir = Path(package_dir) / 'models'
    for name, expected in MODEL_SHA256.items():
        path = model_dir / name
        if not path.is_file():
            raise RuntimeError(f'Offline OCR model missing: {name}')
        with path.open('rb') as model_file:
            digest = hashlib.file_digest(model_file, 'sha256').hexdigest()
        if digest != expected:
            raise RuntimeError(f'Offline OCR model hash mismatch: {name}')


def deny_network():
    """OCR recognition has no reason to create a network socket."""
    def blocked(*_args, **_kwargs):
        raise RuntimeError('Network disabled in local OCR process')
    socket.create_connection = blocked
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked


def _bounds(box):
    xs = [float(point[0]) for point in box]
    ys = [float(point[1]) for point in box]
    return [min(xs), min(ys), max(xs), max(ys)]


def _join_fragments(fragments):
    out = ''
    last = None
    for fragment in fragments:
        part = fragment['text']
        deduplicated = False
        # RapidOCR may emit the same glyph in two intersecting detector boxes.
        # Drop only an identical overlapping glyph supported by character geometry.
        if last is not None and out and part and out[-1] == part[0]:
            prior_boxes = last.get('characterBoxes') or []
            next_boxes = fragment.get('characterBoxes') or []
            if prior_boxes and next_boxes:
                a, b = prior_boxes[-1], next_boxes[0]
                overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
                width = min(a[2] - a[0], b[2] - b[0])
                if width > 0 and overlap / width >= 0.55:
                    part = part[1:]
                    deduplicated = True
        if last is not None and out and part:
            gap = fragment['box'][0] - last['box'][2]
            height = min(fragment['box'][3] - fragment['box'][1], last['box'][3] - last['box'][1])
            # Keep OCR's own spaces. A spatial gap, including overlapping detections,
            # separates tokens; never invent or correct individual characters/digits.
            if not out[-1].isspace() and not part[0].isspace() and not deduplicated and (gap > height * 0.18 or gap < -height * 0.35):
                out += ' '
        out += part
        last = fragment
    return out


def organize(raw):
    """Group OCR polygons by vertical center, then order fragments left-to-right."""
    segments = []
    for item in raw or []:
        if len(item) < 3:
            continue
        box = _bounds(item[0])
        segment = {'text': str(item[1]), 'box': [round(v, 2) for v in box],
                   'confidence': round(float(item[2]), 4)}
        if len(item) > 3 and item[3]:
            segment['characterBoxes'] = [_bounds(glyph) for glyph in item[3]]
        segments.append(segment)
    segments.sort(key=lambda s: ((s['box'][1] + s['box'][3]) / 2, s['box'][0]))
    rows = []
    for segment in segments:
        center = (segment['box'][1] + segment['box'][3]) / 2
        height = segment['box'][3] - segment['box'][1]
        found = None
        for row in rows:
            if abs(center - row['center']) <= 0.45 * min(height, row['height']):
                found = row
                break
        if found is None:
            found = {'center': center, 'height': height, 'fragments': []}
            rows.append(found)
        found['fragments'].append(segment)
    rows.sort(key=lambda row: row['center'])
    lines = []
    for row in rows:
        parts = sorted(row['fragments'], key=lambda s: s['box'][0])
        lines.append({'text': _join_fragments(parts), 'fragments': parts})
    return {'text': '\n'.join(line['text'] for line in lines), 'lines': lines, 'engine': ENGINE}


def _has_strong_horizontal_overlap(fragments):
    parts = sorted(fragments, key=lambda part: part['box'][0])
    for left, right in zip(parts, parts[1:]):
        a, b = left['box'], right['box']
        overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
        narrower = min(a[2] - a[0], b[2] - b[0])
        if narrower > 0 and overlap / narrower >= 0.20:
            return True
    return False


def refine_overlapping_lines(payload, image, engine):
    """Re-recognize a geometrically ambiguous whole row, not guessed text."""
    height, width = image.shape[:2]
    for line in payload['lines']:
        parts = line['fragments']
        if len(parts) < 2 or not _has_strong_horizontal_overlap(parts):
            continue
        x1 = min(part['box'][0] for part in parts)
        y1 = min(part['box'][1] for part in parts)
        x2 = max(part['box'][2] for part in parts)
        y2 = max(part['box'][3] for part in parts)
        pad = max(5, round((y2 - y1) * 0.14))
        left, top = max(0, int(x1) - pad), max(0, int(y1) - pad)
        right, bottom = min(width, int(x2) + pad), min(height, int(y2) + pad)
        if right <= left or bottom <= top:
            continue
        result, _elapsed = engine(image[top:bottom, left:right], use_det=False, use_cls=False)
        if result and len(result) == 1 and len(result[0]) >= 2 and float(result[0][1]) >= 0.90:
            line['detectorText'] = line['text']
            line['text'] = str(result[0][0])
            line['reRecognized'] = {'box': [left, top, right, bottom],
                                    'confidence': round(float(result[0][1]), 4)}
    payload['text'] = '\n'.join(line['text'] for line in payload['lines'])
    return payload


def recognize(image_path):
    from rapidocr_onnxruntime import RapidOCR
    import rapidocr_onnxruntime
    verify_models(Path(rapidocr_onnxruntime.__file__).resolve().parent)
    deny_network()
    engine = RapidOCR()
    result, _elapsed = engine(str(image_path), return_word_box=True)
    payload = organize(result)
    if any(_has_strong_horizontal_overlap(line['fragments']) for line in payload['lines']):
        import cv2
        image = cv2.imread(str(image_path))
        if image is not None:
            refine_overlapping_lines(payload, image, engine)
    return payload


def main(argv):
    if len(argv) != 2 or not Path(argv[1]).is_file():
        print('Usage: ocr_rapid.py IMAGE_PATH', file=sys.stderr)
        return 2
    try:
        payload = recognize(Path(argv[1]).resolve())
    except Exception as exc:
        print(f'Local OCR failed: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
