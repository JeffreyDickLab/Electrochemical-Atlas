#!/usr/bin/env python3
"""Optional maintainer annotation for PDF source-position equation metadata.

This optional maintainer utility outputs page coordinates ONLY (no glyphs,
text, images, page snapshots, or PDF bytes). It is never run during a public
build. Requires a lawfully obtained matching PDF supplied as an argument.
The normal Atlas runtime uses the generated coordinates with a user-selected
local PDF and never modifies that document.
"""
import argparse
import collections
import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path

try:
    import fitz
except ImportError as exc:
    raise SystemExit("This optional maintainer tool requires PyMuPDF: python -m pip install PyMuPDF") from exc

PROSE_START = re.compile(r"^\s*(?:where|thus|since|hence|show\s+that|recognizing|using|in\s+general|in\s+this|in\s+which|we\s+|this\s+|the\s+|if\s+|therefore|now\s+|after\s+|before\s+|gives\b|which\s+|consider\s+|for\s+|also\s+|one\s+|note\s+|at\s+the\s+|in\s+the\s+|from\s+|to\s+|either\s+|by\s+|or\s+|and\s+|assuming\s+|when\s+|given\s+|substituting\s+|then\s+|our\s+|with\s+|an\s+|a\s+|it\s+|its\s+|further\s+|alternatively\s+|these\s+|equations?\b|figures?\b|reactions?\b|terms?\b|values?\b)(?:\b|\s|,|:)",re.I)
STOPWORD = re.compile(r'\b(?:the|and|for|with|which|that|from|where|when|since|using|also|this|these|there|then|are|can|will|has|is|in|of|on|at|as|by|to|into|for|were|would|equation|shown|because|following|we|its|let|than|gives|above|below|expression|describes|respect|thus|note|therefore|however|similar|obtain|found)\b',re.I)
SOURCE_NUM = re.compile(r'^\s*\((?:\d{1,2}|A|B)\.\d+\.\d+(?:[a-z](?:,[a-z])?)?\)\s*$')


def classify(txt,rect,crop):
    txt=''.join(txt.splitlines()).strip();
    if not txt:return None
    if SOURCE_NUM.match(txt) and rect.x0>360:
        return 'equation-number'
    if re.match(r'^(?:location[,\s]|energy as(?:[0-9]+)?$|recognizing\s+|given by|shown by|following\s+|linear\s+|substituting\s+)',txt,re.I) and '=' not in txt:
        return 'short-leadin'
    if re.match(r'^[a-d]\)\s+[A-Z][a-z]{2,}',txt):
        return 'enumerated-prose'
    if re.search(r'\bgives\s*$',txt,re.I) and rect.x0>=120:
        return 'math-adjacent-prose'
    if re.search(r'(?:\bEvaluation of|\bwe can still|\bto be|\bmay be|\bmust await|\bshown in|\bwhich is|\bthe following|\bif and only if|\btherefore)',txt,re.I) and len(txt)>19 and len(STOPWORD.findall(txt))>=1:
        return 'prose-fragment'
    start = bool(PROSE_START.match(txt))
    stops=len(STOPWORD.findall(txt))
    words=re.findall(r'[A-Za-z]{3,}',txt)
    math_score=sum(txt.count(s) for s in ('=', '∂', '∕', '∫', 'Σ', '∑', '−', '√','∞','∇','±','⇌','→','𝜂','𝜎','𝜙','𝛿','𝜆','𝛼','𝛽'))
    if rect.x0 <= 74.5:
        if start and len(txt)>=5:
            return 'body-start'
        if stops>=2 and len(words)>=3:
            return 'body-stopwords'
        if len(words)>=6 and (rect.width>165 or len(txt)>75):
            return 'body-prose'
    if rect.width > 205 and len(words)>=8 and stops>=2:
        return 'long-prose'
    if rect.width > 140 and len(words)>=6 and stops>=3:
        return 'prose'
    if start and (stops>=2 or txt.lower().endswith('gives') or re.match(r'^[a-z]\)',txt, re.I)) and len(txt)>6 and math_score<4:
        return 'phrase'
    if start and rect.x0 < 91 and (stops>=1 or txt.lower().endswith('gives')) and len(words)>=1 and math_score <= 1 and len(txt)>5:
        return 'short-prose'
    return None


def subtract_rectangle(rect, protect):
    intersection = rect & protect
    if intersection.is_empty or intersection.get_area() < rect.get_area()*.03:
        return [rect]
    return [
        fitz.Rect(rect.x0,rect.y0,rect.x1,intersection.y0),
        fitz.Rect(rect.x0,intersection.y1,rect.x1,rect.y1),
        fitz.Rect(rect.x0,intersection.y0,intersection.x0,intersection.y1),
        fitz.Rect(intersection.x1,intersection.y0,rect.x1,intersection.y1),
    ]


def derive(doc,manifest):
    bypage=collections.defaultdict(list)
    for k,e in manifest['entries'].items():
        if 'crop' in e:bypage[e['page']].append((k,e))
    counts=collections.Counter();samples=collections.defaultdict(list)
    for page_id,items in bypage.items():
        p=doc[page_id-1]
        lines=[]
        words=[fitz.Rect(w[:4]) for w in p.get_text('words',sort=False)]
        for b in p.get_text('dict')['blocks']:
            for line in b.get('lines',[]):
                rect=fitz.Rect(line['bbox']);txt=''.join(span['text'] for span in line['spans'])
                lines.append((rect,txt))
        for k,e in items:
            crop=fitz.Rect(e['crop']);exclusions=[];mathlines=[];excluded=[]
            for rc,txt in lines:
                if not crop.intersects(rc):continue
                intersection=crop&rc
                if intersection.width < 1 or intersection.height < .3:continue
                why=classify(txt,rc,crop)
                if why is None:
                    mathlines.append((rc,txt))
                    continue
                # Do not overwrite equation content if it substantially overlaps a
                # known peer's entire region; those will be cropped separately.
                pad=1.15
                rr=[round(v,2) for v in (max(0,rc.x0-pad),max(0,rc.y0-pad),min(p.rect.width,rc.x1+pad),min(p.rect.height,rc.y1+pad))]
                if rr[2]<=rr[0] or rr[3]<=rr[1]:continue
                # The PDF occasionally overlays a tall mathematical bracket
                # with paragraph text. Erase individual prose words, never a
                # wide paragraph rectangle crossing protected formula glyphs.
                excluded.append(rc)
                counts[why]+=1
                if len(samples[why])<15:samples[why].append((k,txt,round(rc.y0,2)))
            if excluded:
                anchor_lines=[r for r,t in lines if t.strip()==f'({k})' and r.x0>375]
                anchor=anchor_lines[0].y0 if anchor_lines else (crop.y0+crop.y1)/2
                protected=[r for r,t in mathlines if abs((r.y0+r.y1)/2-anchor)<max(20, crop.height*.56)]
                for rc in excluded:
                    current=[]
                    for wr in words:
                        inner=wr & rc
                        if not inner.is_empty and inner.get_area()>wr.get_area()*.60 and crop.intersects(wr):
                            current.append(wr)
                    # A few formula references are non-word vector glyphs.
                    if not current: current=[rc]
                    for wr in current:
                        pad=.45
                        masked=fitz.Rect(wr.x0-pad,wr.y0-pad,wr.x1+pad,wr.y1+pad)
                        preserved=[masked]
                        if not (masked.x0>=390 and SOURCE_NUM.match(next((t for r,t in lines if r==rc),''))):
                            for protected_span in protected:
                                if not preserved:break
                                preserved=[piece for r in preserved for piece in subtract_rectangle(r,protected_span)]
                        for piece in preserved:
                            piece &= p.rect
                            if piece.width<.55 or piece.height<.55:continue
                            exclusions.append([round(v,2) for v in piece])
                if exclusions:e['exclude']=exclusions
                # When the printed equation number is followed by unrelated
                # paragraph or problem text, crop the entire lower region,
                # including fragments split into several PDF text runs.
                number_lines=[r for r,t in lines if t.strip()==f'({k})' and r.x0>375]
                if number_lines:
                    anchor=number_lines[0].y0
                    lower=[r.y0 for r in excluded if r.x0<390 and
                           r.y0>anchor+12 and r.y0 < crop.y1-2]
                    if lower:
                        cutoff=min(lower)-2.0
                        if cutoff-crop.y0>=12 and cutoff<crop.y1-5:
                            e['focus']=[round(crop.x0,2), round(crop.y0,2),
                                        round(crop.x1,2),round(cutoff,2)]
                # Tightening the rendered region also removes partially sliced
                # neighboring text. Only use this when every in-crop text line
                # has been assigned to math or a known exclusion.
                candidates=[rc for rc,txt in mathlines if rc.x1>crop.x0+1 and rc.x0<crop.x1-1
                    and (rc & crop).height > .8]
                if candidates:
                    min_y=min(rc.y0 for rc in candidates)-2.5
                    max_y=max(rc.y1 for rc in candidates)+2.5
                    min_y=max(crop.y0,min_y)
                    max_y=min(crop.y1,max_y)
                    if max_y-min_y>=10 and (min_y-crop.y0>2 or crop.y1-max_y>2):
                        # Constrain a secondary trim to the confidence-based
                        # lower cutoff and never expand it into known prose.
                        if 'focus' in e:
                            if min_y < e['focus'][3]-8:
                                e['focus'][1]=round(min_y,2)
                        else:
                            e['focus']=[round(crop.x0,2),round(min_y,2),
                                        round(crop.x1,2),round(max_y,2)]
    return counts,samples

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('pdf')
    ap.add_argument('source_map')
    ap.add_argument('--out',required=True)
    ap.add_argument('--replace-reviewed',action='store_true',
        help='Explicitly allow regenerating masks/focus coordinates that have already been reviewed.')
    args=ap.parse_args()
    if Path(args.out).resolve()==Path(args.source_map).resolve():
        raise SystemExit('Refusing to overwrite the maintained source map. Write a separate candidate JSON, review it, then replace deliberately.')
    manifest=json.loads(Path(args.source_map).read_text())
    # A regeneration must not silently erase manually approved cropping. The
    # old unguarded script did this and could undo months of equation fixes.
    original_metadata = {label: deepcopy(entry) for label, entry in manifest['entries'].items()}
    with open(args.pdf, 'rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != manifest.get('pdf_sha256'):
        raise SystemExit('The supplied PDF does not match this equation index; no changes were written.')
    if args.replace_reviewed:
        for entry in manifest['entries'].values():
            entry.pop('focus', None)
            entry.pop('exclude', None)
    with fitz.open(args.pdf) as doc:
        counts,samples=derive(doc,manifest)
    # These source-verified exceptions protect tightly stacked expressions.
    entries = manifest['entries']
    entries['3.7.23']['focus'] = [79.0,440.82,245.0,472.50]
    entries['8.4.1a']['focus'] = [76.0,409.6,193.0,443.0]
    entries['3.5.64'].setdefault('exclude', []).append([55.35,454.1,105.25,467.2])
    for x0,x1 in ((75.0,113.7),(122.3,176.8),(184.9,226.0),
                  (234.4,289.6),(297.6,347.0)):
        entries['9.5.3'].setdefault('exclude', []).append([x0,252.25,x1,258.15])
    # The last portion is an isolated fragment of a reference on the line
    # above the expression; it is not part of the mathematical bracket.
    entries['9.5.3']['exclude'].append([181.8,253.2,184.15,255.62])
    if not args.replace_reviewed:
        retained = 0
        for label, previous in original_metadata.items():
            current = entries[label]
            for field in ('focus', 'exclude', 'frames', 'exactFocus', 'anchorY'):
                if field in previous:
                    current[field] = deepcopy(previous[field])
                    retained += 1
                else:
                    # Prevent a speculative hard-coded override from silently
                    # creating new reviewed metadata on a previously bare entry.
                    if field in ('exactFocus', 'anchorY'):
                        current.pop(field, None)
        print(f'Preserved {retained} existing reviewed/anchor metadata fields. Use --replace-reviewed only after manual source verification.')
    expected_anchors = sum(isinstance(e.get('anchorY'),list) for e in original_metadata.values())
    actual_anchors = sum(isinstance(e.get('anchorY'),list) for e in entries.values())
    if actual_anchors != expected_anchors:
        raise SystemExit('The regenerated index would change equation anchors; no output written.')
    Path(args.out).write_text(json.dumps(manifest,separators=(',',':'),ensure_ascii=False)+'\n')
    print('classification',counts)
    print('entries with masks',sum(bool(e.get('exclude')) for e in manifest['entries'].values()),'total masks',sum(len(e.get('exclude',[])) for e in manifest['entries'].values()))
    for why,exs in samples.items():
        print('\n',why);print('\n'.join(f' {lab}: {txt[:110]} (y{y})' for lab,txt,y in exs))
