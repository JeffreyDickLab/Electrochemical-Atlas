#!/usr/bin/env python3
"""Source-only equation-boundary risk audit for the original PDF.

The check uses equation-number anchors and ink measurements, rather than
accepting any visible pixels as proof of equation fidelity. It never writes
book text, glyph shapes, or copied PDF artwork into the report. The original
PDF is needed only on the maintainer's machine; do not commit it.

Usage:
  python tools/maintainers/audit_equation_boundaries.py /local/original.pdf \
    --report docs/EQUATION_BOUNDARY_REVIEW.json

Requires the optional PyMuPDF and Pillow development dependencies.
Warning labels are triage cues, not automatically proven defects.
"""
import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


def mask_contains(x, y, exclusions):
    return any(r[0] <= x <= r[2] and r[1] <= y <= r[3] for r in exclusions)


def build_report(pdf_path, index_path):
    import fitz
    from PIL import Image, ImageDraw

    manifest = json.loads(index_path.read_text(encoding='utf8'))
    with pdf_path.open('rb') as f:
        sha = hashlib.file_digest(f, 'sha256').hexdigest()
    if sha != manifest['pdf_sha256']:
        raise ValueError('The PDF does not match the source-equation index')
    entries = manifest['entries']
    findings = []
    summary = Counter()
    document = fitz.open(pdf_path)
    if len(document) != manifest['pdf_pages']:
        raise ValueError('Unexpected original PDF page count')
    by_page = defaultdict(list)
    for label, entry in entries.items():
        if not entry.get('parts'):
            by_page[entry['page']].append((label, entry))
        else:
            summary['combined_references'] += 1

    number_pattern = re.compile(r'^\(([^()]+)\)$')
    for number, page_entries in sorted(by_page.items()):
        page = document[number-1]
        lines = []
        anchors = {}
        for block in page.get_text('dict')['blocks']:
            for ln in block.get('lines', []):
                box=fitz.Rect(ln['bbox'])
                txt=''.join(s['text'] for s in ln['spans']).strip()
                lines.append((box,txt))
                if box.x0>355:
                    m=number_pattern.fullmatch(txt)
                    if m:
                        anchors[m.group(1)] = box
        for label, entry in page_entries:
            summary['standalone_regions'] += 1
            bounds=entry.get('focus') or entry.get('crop')
            if not bounds or len(bounds)!=4:
                findings.append({'label':label,'page':number,'reasons':['missing_crop']})
                continue
            x0,y0,x1,y1=bounds
            exact=bool(entry.get('focus') and entry.get('exactFocus'))
            margin=0 if exact else .55
            bounds=fitz.Rect(max(0,x0-margin), max(0,y0-margin), min(page.rect.width,x1+margin), min(page.rect.height,y1+margin))
            if bounds.width<8 or bounds.height<7:
                findings.append({'label':label,'page':number,'reasons':['invalid_crop']})
                continue
            reasons=[]
            marker=anchors.get(label)
            if marker is None:
                # Split typesetting labels occasionally does not yield a single
                # PDF text item. Flag it instead of assuming coordinates valid.
                reasons.append('number_anchor_unresolved')
            # Printed numbering anchors make overlapping neighboring equations
            # identifiable independently of text content in the crop.
            for peer_label, peer in page_entries:
                if peer_label == label or peer_label not in anchors: continue
                other=anchors[peer_label]
                if bounds.y0+1 < other.y0 < bounds.y1-1:
                    if marker is None or abs(other.y0-marker.y0)>4:
                        reasons.append('neighbor_number_band')
                        break
            # Count prose-like text lines intersecting crop edges, excluding
            # masks already approved by the human source review.
            masks=entry.get('exclude',[])
            for box, txt in lines:
                if box.x0>355 or box.x1<bounds.x0 or box.x0>bounds.x1:continue
                fragment=box & bounds
                if fragment.is_empty or fragment.height<1:continue
                midx=(fragment.x0+fragment.x1)/2
                midy=(fragment.y0+fragment.y1)/2
                if mask_contains(midx,midy,masks):continue
                long_prose=sum(1 for word in txt.split() if len(word)>=4 and word.isalpha())>=3
                touches_edge=(box.y0 < bounds.y0+2 or box.y1>bounds.y1-2)
                if long_prose and touches_edge and marker is not None and abs(box.y0-marker.y0)>4:
                    reasons.append('possible_edge_prose')
                    break
            # Pixel check on a sampled low-resolution source region, with the
            # masks applied. A tiny disconnected fringe at the crop boundary is
            # a risk signal but cannot establish a mathematical transcription.
            pm=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),clip=bounds,alpha=False)
            img=Image.frombytes('RGB',(pm.width,pm.height),pm.samples)
            if masks:
                draw=ImageDraw.Draw(img)
                for bx in masks:
                    if len(bx)!=4:continue
                    x0,y0,x1,y1=bx
                    draw.rectangle(((x0-bounds.x0)*1.5,(y0-bounds.y0)*1.5,
                                    (x1-bounds.x0)*1.5,(y1-bounds.y0)*1.5),fill='white')
            grayscale=img.convert('L')
            w,h=img.size
            edge=max(1,min(3,h//7))
            for side in ('top','bottom'):
                region=grayscale.crop((0,0,w,edge)) if side=='top' else grayscale.crop((0,h-edge,w,h))
                dark=sum(region.histogram()[:150])
                # Only flag sparse detached fragments; an equation intentionally
                # reaching the margin should be inspected rather than erased.
                if 0 < dark <= max(9, w*.06):
                    reasons.append('sparse_'+side+'_edge_ink')
            if reasons:
                findings.append({'label':label,'page':number,'reasons':sorted(set(reasons))})
                for why in set(reasons):summary['risk_'+why]+=1
    document.close()
    summary['indexed_entries']=len(entries)
    summary['flagged_regions']=len(findings)
    summary['source_pages']=manifest['pdf_pages']
    return {'summary':dict(summary), 'findings':findings,
            'scope':'Source-coordinate and sampled-ink risk scan, not full visual verification or a PDF.js browser acceptance test.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path)
    parser.add_argument('--index',type=Path, default=Path(__file__).resolve().parents[2]/'src/client/equations/source-map.json')
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    report=build_report(args.pdf,args.index)
    if args.report:
        args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    print(json.dumps(report['summary'],indent=2))

if __name__=='__main__':main()
