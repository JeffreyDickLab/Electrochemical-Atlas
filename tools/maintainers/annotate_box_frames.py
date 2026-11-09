#!/usr/bin/env python3
"""Annotate printable equation frame strokes using PDF vector geometry.

Offline *maintainer-only* tool; the supplied PDF is never bundled or copied.
Output stores page coordinates only, not extracted prose or publisher artwork.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import fitz

TOL = 0.9

def rectangle_frames(page: fitz.Page) -> list[list[float]]:
    horizontals = []
    verticals = []
    for drawing in page.get_drawings():
        if not drawing['type'].endswith('s') and drawing['type'] != 's':
            continue
        if drawing.get('width', 0) > 1.5:
            continue
        for item in drawing['items']:
            if item[0] != 'l':
                continue
            a,b=item[1:3]
            if abs(a.y-b.y)<0.12 and abs(a.x-b.x)>24:
                horizontals.append((min(a.x,b.x),max(a.x,b.x),(a.y+b.y)/2))
            elif abs(a.x-b.x)<0.12 and abs(a.y-b.y)>10:
                verticals.append(((a.x+b.x)/2,min(a.y,b.y),max(a.y,b.y)))
    frames = set()
    for lx,top,bottom in verticals:
        if lx < 0 or bottom > page.rect.height:
            continue
        for rx,top2,bottom2 in verticals:
            if rx-lx < 35 or rx-lx > page.rect.width*.88:
                continue
            if abs(top2-top)>TOL or abs(bottom2-bottom)>TOL:
                continue
            if bottom-top < 12 or bottom-top > 160:
                continue
            htop = any(abs(y-top)<TOL and abs(x0-lx)<TOL and abs(x1-rx)<TOL
                       for x0,x1,y in horizontals)
            hbottom = any(abs(y-bottom)<TOL and abs(x0-lx)<TOL and abs(x1-rx)<TOL
                          for x0,x1,y in horizontals)
            if htop and hbottom:
                frames.add(tuple(round(v, 2) for v in (lx,top,rx,bottom)))
    return [list(f) for f in sorted(frames)]


def annotate(pdf_path: Path, map_path: Path) -> dict:
    manifest = json.loads(map_path.read_text())
    by_page: dict[int,list[tuple[str, dict]]] = defaultdict(list)
    for label,e in manifest['entries'].items():
        if 'crop' in e:
            by_page[int(e['page'])].append((label,e))
    stats=Counter()
    with fitz.open(pdf_path) as doc:
        for page_no, entries in by_page.items():
            page=doc[page_no-1]
            frames=rectangle_frames(page)
            stats['total_source_frames']+=len(frames)
            for label,e in entries:
                crop=fitz.Rect(e['focus'] if 'focus' in e else e['crop'])
                keep=[]
                for rect in frames:
                    frame=fitz.Rect(rect)
                    overlap=frame&crop
                    if overlap.is_empty: continue
                    fraction=overlap.get_area()/max(1,frame.get_area())
                    center=(frame.tl+frame.br)/2
                    if fraction>=0.37 and fitz.Rect(crop.x0-6,crop.y0-6,crop.x1+6,crop.y1+6).contains(center):
                        keep.append(rect)
                if keep:
                    e['frames']=keep
                    stats['entries_with_frames']+=1
                    stats['matched_frames']+=len(keep)
                    if label in ('1.3.7','1.3.22','1.3.24','1.3.23'):
                        print(label,keep)
                elif 'frames' in e:
                    del e['frames']
    stats['total_entries']=len(manifest['entries'])
    print(dict(stats))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf',type=Path)
    parser.add_argument('manifest',type=Path)
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    if args.out.resolve()==args.manifest.resolve():
        parser.error('Refusing to overwrite the source manifest. Review a separate output file first.')
    args.out.write_text(json.dumps(annotate(args.pdf,args.manifest),ensure_ascii=False,separators=(',',':'))+'\n')
