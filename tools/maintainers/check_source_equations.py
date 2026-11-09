#!/usr/bin/env python3
"""Audit the Atlas equation index against a separately supplied original PDF.

Read-only: never exports page images, extracted mathematical glyphs, or text.
Output contains only equation IDs, positions, and status codes. This tests
PyMuPDF source crops, not the separate PDF.js browser rendering pipeline.

Usage:
  python -m pip install PyMuPDF Pillow
  python tools/maintainers/check_source_equations.py /path/to/textbook.pdf \
      --report local-audit.json

Keep local-audit.json outside the public repository if desired. Never commit
or distribute the publisher's original PDF.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path


def source_crop(entry: dict, width: float, height: float) -> tuple[float, ...] | None:
    """Match the JavaScript renderer's actual cropFor() coordinates."""
    rect = entry.get('focus', entry.get('crop'))
    if not isinstance(rect, list) or len(rect) != 4:
        return None
    if not all(isinstance(v, (int, float)) for v in rect):
        return None
    l, t, r, b = rect
    margin = 0 if entry.get('focus') and entry.get('exactFocus') else .55
    return (max(0, l - margin), max(0, t - margin),
            min(width, r + margin), min(height, b + margin))


def is_visible(image) -> bool:
    # At least 15 dark pixels after masks indicates some source content remains.
    return sum(image.convert('L').histogram()[:190]) >= 15


def validate_pdf(pdf_path: Path, expected_hash: str) -> None:
    h = hashlib.sha256()
    with pdf_path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    if h.hexdigest() != expected_hash:
        raise ValueError('The selected PDF does not match the index fingerprint.')


def audit(pdf_path: Path, index_path: Path) -> dict:
    try:
        import fitz
        from PIL import Image, ImageDraw
    except ImportError as err:
        raise RuntimeError('Install PyMuPDF and Pillow to audit the source PDF.') from err

    manifest = json.loads(index_path.read_text(encoding='utf-8'))
    validate_pdf(pdf_path, manifest['pdf_sha256'])
    entries = manifest['entries']
    counts = Counter()
    flagged = []
    pdf = fitz.open(pdf_path)
    if len(pdf) != manifest['pdf_pages']:
        raise ValueError('PDF page count does not match the equation index.')
    for label, entry in entries.items():
        if not 1 <= entry.get('page', 0) <= len(pdf):
            flagged.append({'label': label, 'reason': 'invalid_page'})
            continue
        if entry.get('parts'):
            if not all(p in entries for p in entry['parts']):
                flagged.append({'label': label, 'reason': 'missing_composite_part'})
            else:
                counts['paired_references'] += 1
            continue
        page = pdf[entry['page'] - 1]
        region = source_crop(entry, page.rect.width, page.rect.height)
        if not region or region[2] - region[0] < 8 or region[3] - region[1] < 7:
            flagged.append({'label': label, 'reason': 'invalid_crop'})
            continue
        clip = fitz.Rect(region)
        scale = 1.5
        raster = page.get_pixmap(matrix=fitz.Matrix(scale, scale),
                                 clip=clip, alpha=False)
        image = Image.frombytes('RGB', (raster.width, raster.height), raster.samples)
        draw = ImageDraw.Draw(image)
        def pixel_box(rect):
            return (int((rect[0] - clip.x0) * scale),
                    int((rect[1] - clip.y0) * scale),
                    int((rect[2] - clip.x0) * scale),
                    int((rect[3] - clip.y0) * scale))
        for mask in entry.get('exclude', []):
            if len(mask) == 4:
                draw.rectangle(pixel_box(mask), fill='white')
                counts['source_masks_applied'] += 1
        for frame in entry.get('frames', []):
            x0, y0, x1, y1 = pixel_box(frame)
            for a, b in [((x0, y0), (x1, y0)), ((x0, y1), (x1, y1)),
                         ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))]:
                draw.line([a, b], fill='white', width=3)
            counts['source_frames_masked'] += 1
        if not is_visible(image):
            flagged.append({'label': label, 'reason': 'no_visible_content_after_masking'})
            continue
        counts['visible_equations'] += 1
    pdf.close()
    counts['indexed_entries'] = len(entries)
    return {'pdf_pages': manifest['pdf_pages'], 'summary': dict(counts),
            'flagged': flagged,
            'disclaimer': 'Source-crop structural check only. Does not guarantee every symbol is visually correct in PDF.js.'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path, help='User-supplied local original PDF')
    parser.add_argument('--index', type=Path, default=Path(__file__).resolve().parents[2] /
                        'src/client/equations/source-map.json')
    parser.add_argument('--report', type=Path, help='Optional audit JSON output')
    args = parser.parse_args()
    result = audit(args.pdf, args.index)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result['summary'], indent=2))
    if result['flagged']:
        print('Flagged equation IDs:', ', '.join(e['label'] for e in result['flagged']))
        raise SystemExit(1)
    print('Every indexed equation has a valid region with visible source content.')


if __name__ == '__main__':
    main()
