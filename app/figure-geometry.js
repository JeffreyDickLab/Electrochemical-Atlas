/**
 * Identify a figure on a reader-supplied PDF page, at preview time.
 *
 * This module stores no source artwork or per-book crop coordinates. Both the
 * PDF.js text positions and rendered pixels are discarded after the preview.
 * Text is used as a boundary/label, never painted over in the output.
 */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasFigureGeometry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const norm = value =>
    String(value || '')
      .replace(/[\u00a0\s]+/g, ' ')
      .trim();
  const normalLabel = value =>
    norm(value)
      .replace(/\s*\.\s*/g, '.')
      .replace(/[\u2013\u2014]/g, '-')
      .toLowerCase();

  function textBoxes(items, viewport) {
    const boxes = [];
    for (const item of items || []) {
      if (typeof item.str !== 'string' || !item.str.trim() || !Array.isArray(item.transform))
        continue;
      const transform = item.transform;
      const [x, baseline] = viewport.convertToViewportPoint(transform[4], transform[5]);
      const width = Math.max(0, Number(item.width || 0) * viewport.scale);
      const height = Math.max(
        3,
        Number(item.height || Math.hypot(transform[2], transform[3]) || 8) * viewport.scale
      );
      boxes.push({
        text: norm(item.str),
        x,
        y: baseline - height * 0.91,
        width,
        height: height * 1.16
      });
    }
    return boxes;
  }

  function textRows(boxes) {
    const rows = [];
    for (const box of [...(boxes || [])].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (
        !box ||
        !Number.isFinite(box.x) ||
        !Number.isFinite(box.y) ||
        !(box.width >= 0) ||
        !(box.height > 0) ||
        !box.text
      )
        continue;
      const row = rows.find(
        candidate => Math.abs(candidate.y - box.y) < Math.max(3.5, Math.min(6, box.height * 0.44))
      );
      if (row) row.items.push(box);
      else rows.push({ y: box.y, items: [box] });
    }
    return rows
      .map(row => {
        row.items.sort((a, b) => a.x - b.x);
        const left = Math.min(...row.items.map(box => box.x));
        const right = Math.max(...row.items.map(box => box.x + box.width));
        const bottom = Math.max(...row.items.map(box => box.y + box.height));
        const text = row.items.map(box => box.text).join(' ');
        return {
          top: row.y,
          bottom,
          left,
          right,
          text,
          items: row.items,
          words: (text.match(/[\p{L}]{2,}/gu) || []).length
        };
      })
      .sort((a, b) => a.top - b.top);
  }

  /** Caption prefixes are anchored at a printed line start, not a prose mention. */
  function captionLabel(text) {
    const compact = norm(text).replace(/\s*\.\s*(?=\d)/g, '.');
    const hit = compact.match(
      /^(?:Figure|Fig\.?)[\s\u00a0]*([A-C]\.\d+(?:\.\d+){0,3}[a-z]?|\d+(?:\.\d+){0,4}[a-z]?)(?!\d|\.\d)/i
    );
    return hit ? normalLabel(hit[1]) : null;
  }

  /** All printed caption anchors for a page; allows two figures on one page. */
  function findCaptions(boxes) {
    const found = [];
    for (const row of textRows(boxes)) {
      // PDF.js may split 'Figure', the number, and punctuation across runs.
      // Some rows also contain independent text in a neighboring column.
      for (let i = 0; i < Math.min(8, row.items.length); i++) {
        const first = row.items[i];
        if (!/^(?:Figure|Fig\.?)(?=$|\s|\d|[A-C]\.\d)/i.test(first.text)) continue;
        const before = row.items.slice(0, i);
        // Text far to the left can belong to another PDF column. Only
        // reject a preceding word on the SAME printed line/column.
        if (
          before.some(item => /[\p{L}]{2,}/u.test(item.text) && item.x + item.width > first.x - 18)
        )
          continue;
        const joined = row.items
          .slice(i, i + 9)
          .map(item => item.text)
          .join(' ');
        const label = captionLabel(joined);
        if (!label) continue;
        found.push({
          label,
          top: first.y,
          bottom: row.bottom,
          x: first.x,
          // A line beginning in the book's body margin is more credible than
          // a reference embedded in a plot or a distant column.
          score: 100 - i * 7 - Math.max(0, row.items.length - i - 10)
        });
        break;
      }
    }
    // PDF.js can assign different baselines to the bold 'Figure' prefix and
    // a smaller numbered suffix. Reassemble nearby pieces with a wider
    // baseline tolerance only when the ordinary text-line pass missed them.
    for (const first of boxes || []) {
      if (!/^(?:Figure|Fig\.?)(?=$|\s|\d|[A-C]\.\d)/i.test(first.text)) continue;
      if (found.some(hit => Math.abs(hit.top - first.y) < 4 && Math.abs(hit.x - first.x) < 8))
        continue;
      const near = boxes
        .filter(
          box => box.x >= first.x - 3 && box.x < first.x + 240 && Math.abs(box.y - first.y) < 16
        )
        .sort((a, b) => a.x - b.x);
      const after = near.slice(near.indexOf(first));
      const label = captionLabel(
        after
          .slice(0, 8)
          .map(box => box.text)
          .join(' ')
      );
      if (label)
        found.push({
          label,
          top: first.y,
          bottom: Math.max(...after.slice(0, 8).map(box => box.y + box.height)),
          x: first.x,
          score: 92
        });
    }
    return found.sort((a, b) => a.top - b.top);
  }

  function findCaption(boxes, label) {
    const target = normalLabel(label);
    return (
      findCaptions(boxes)
        .filter(caption => caption.label === target)
        .sort((a, b) => b.score - a.score || a.top - b.top)[0] || null
    );
  }

  /** A sentence-like line is prose, not a plot axis, molecule, or panel label. */
  function isNarrativeRow(row, pageWidth) {
    const span = row.right - row.left;
    return (
      row.text.length >= 42 &&
      row.words >= 7 &&
      (span > pageWidth * 0.4 || (span > pageWidth * 0.29 && row.words >= 10))
    );
  }

  function precedingProseBottom(boxes, pageWidth, visualTop) {
    const rows =
      boxes?.[0] && Number.isFinite(boxes[0].top) && Number.isFinite(boxes[0].words)
        ? boxes
        : textRows(boxes);
    let bottom = -1;
    for (const row of rows) {
      if (!isNarrativeRow(row, pageWidth) || row.bottom > visualTop - 2) continue;
      if (visualTop - row.bottom > 40) continue;
      bottom = Math.max(bottom, row.bottom);
    }
    return bottom;
  }

  function intersects(row, left, right) {
    return row.right >= left && row.left <= right;
  }

  /**
   * Locate the actual artwork on either side of a printed caption. Graphic
   * components are clustered across whitespace (multi-panel figures), while
   * intervening prose and neighboring printed captions act as hard fences.
   */
  function detectCrop({
    data,
    width,
    height,
    boxes = [],
    caption,
    previousCaptionBottom = 0,
    nextCaptionTop = height,
    orientation = 'above'
  }) {
    if (!caption || !(width > 100) || !(height > 100) || !data || data.length < width * height * 4)
      return null;
    const below = orientation === 'below';
    const pageLeft = Math.max(0, Math.floor(width * 0.025));
    const pageRight = Math.min(width, Math.ceil(width * 0.975));
    const top = below
      ? Math.max(0, Math.ceil(caption.bottom + 5))
      : Math.max(Math.round(height * 0.018), Math.ceil(previousCaptionBottom + 5));
    const bottom = below
      ? Math.min(height - Math.round(height * 0.018), Math.floor(nextCaptionTop - 5))
      : Math.min(height, Math.floor(caption.top - 4));
    if (bottom - top < 38) return null;

    const mask = new Uint8Array(width * (bottom - top));
    for (const box of boxes) {
      const x0 = clamp(Math.floor(box.x - 2), pageLeft, pageRight);
      const x1 = clamp(Math.ceil(box.x + box.width + 2), pageLeft, pageRight);
      const y0 = clamp(Math.floor(box.y - 2), top, bottom);
      const y1 = clamp(Math.ceil(box.y + box.height + 2), top, bottom);
      for (let y = y0; y < y1; y++) mask.fill(1, (y - top) * width + x0, (y - top) * width + x1);
    }

    const counts = new Uint32Array(height);
    const rowLeft = new Int32Array(height).fill(width);
    const rowRight = new Int32Array(height).fill(-1);
    // Recognize light-gray strokes and color-only illustrations as well as
    // black vector lines. PDF page white/off-white is not considered ink.
    const ink = i => data[i + 3] > 120 && Math.min(data[i], data[i + 1], data[i + 2]) < 241;
    for (let y = top; y < bottom; y++) {
      const offset = (y - top) * width;
      for (let x = pageLeft; x < pageRight; x++) {
        if (mask[offset + x] || !ink((y * width + x) * 4)) continue;
        counts[y]++;
        rowLeft[y] = Math.min(rowLeft[y], x);
        rowRight[y] = Math.max(rowRight[y], x);
      }
    }

    const rows = textRows(boxes);
    const segments = [];
    const bridge = Math.max(8, Math.round(height * 0.017));
    for (let y = top; y < bottom; ) {
      while (y < bottom && !counts[y]) y++;
      if (y >= bottom) break;
      const start = y;
      let end = y,
        total = 0,
        left = width,
        right = -1,
        blank = 0;
      while (y < bottom) {
        if (counts[y]) {
          end = y;
          total += counts[y];
          blank = 0;
          left = Math.min(left, rowLeft[y]);
          right = Math.max(right, rowRight[y]);
        } else if (++blank > bridge) break;
        y++;
      }
      // Short colored marks and scattered plot points are valid, but an
      // isolated antialiased speck is not a whole figure.
      if (total >= 18 && (end - start >= 3 || total >= 65))
        segments.push({ start, end, total, left, right, width: right - left + 1 });
      y = Math.max(y, start + 1);
    }
    if (!segments.length) return null;

    const maxCaptionGap = Math.min(220, height * 0.3);
    const last = segments.length - 1;
    if (
      below ? segments[0].start - top > maxCaptionGap : bottom - segments[last].end > maxCaptionGap
    )
      return null;

    // Assemble disconnected panels, arrows, and graphs belonging to the same
    // caption. A sentence BETWEEN components is a stronger boundary than a
    // blank gap. This intentionally permits large, portrait-oriented figures.
    let first = last;
    const maxGap = Math.max(80, Math.min(170, height * 0.21));
    while (first > 0) {
      const prior = segments[first - 1],
        current = segments[first];
      if (current.start - prior.end > maxGap || segments[last].end - prior.start > height * 0.89)
        break;
      if (
        rows.some(
          row =>
            row.top > prior.end + 1 && row.bottom < current.start - 1 && isNarrativeRow(row, width)
        )
      )
        break;
      first--;
    }
    // For captions printed ABOVE artwork, the first graphical segment is the
    // seed and later panels are the continuation, not earlier body content.
    let chosen = segments.slice(first);
    if (below) {
      chosen = [segments[0]];
      for (let i = 1; i < segments.length; i++) {
        const prior = chosen[chosen.length - 1],
          next = segments[i];
        if (next.start - prior.end > maxGap || next.end - chosen[0].start > height * 0.89) break;
        if (
          rows.some(
            row =>
              row.top > prior.end + 1 && row.bottom < next.start - 1 && isNarrativeRow(row, width)
          )
        )
          break;
        chosen.push(next);
      }
    }
    const visualTop = chosen[0].start;
    const visualBottom = chosen[chosen.length - 1].end;
    const totalInk = chosen.reduce((sum, segment) => sum + segment.total, 0);
    let left = Math.min(...chosen.map(segment => segment.left));
    let right = Math.max(...chosen.map(segment => segment.right));
    if (totalInk < 55 || right - left < 45 || visualBottom - visualTop < 24) return null;

    const preceding = precedingProseBottom(rows, width, visualTop);
    // If prose is located between the picture and its caption, this group is
    // probably an unrelated equation/illustration, not this figure.
    if (
      !below &&
      rows.some(
        row =>
          isNarrativeRow(row, width) && row.top > visualBottom + 12 && row.bottom < caption.top - 6
      )
    )
      return null;
    if (
      below &&
      rows.some(
        row =>
          isNarrativeRow(row, width) && row.top > caption.bottom + 7 && row.bottom < visualTop - 10
      )
    )
      return null;

    let cropLeft = Math.max(pageLeft, left - 11);
    let cropRight = Math.min(pageRight, right + 12);
    let cropTop = Math.max(top, visualTop - 9);
    let cropBottom = Math.min(bottom, visualBottom + 10);
    if (preceding >= 0)
      cropTop = Math.max(cropTop, Math.min(visualTop - 2, Math.ceil(preceding + 2)));

    // Add labels, tick marks, charges, legends and '(a)/(b)' near the
    // artwork. Their text is kept in the output, not separately rewritten.
    // Exclude long narrative rows, headings and the caption itself.
    for (const row of rows) {
      if (row.top < visualTop - 65 || row.top > visualBottom + 65) continue;
      if (isNarrativeRow(row, width)) continue;
      if (row.top < top || row.bottom > bottom) continue;
      if (preceding >= 0 && row.bottom <= preceding + 1) continue;
      if (!intersects(row, cropLeft - 55, cropRight + 55)) continue;
      if (row.words > 15 || row.text.length > 130) continue;
      cropLeft = Math.max(pageLeft, Math.min(cropLeft, row.left - 5));
      cropRight = Math.min(pageRight, Math.max(cropRight, row.right + 5));
      cropTop = Math.max(top, Math.min(cropTop, row.top - 5));
      cropBottom = Math.min(bottom, Math.max(cropBottom, row.bottom + 5));
    }
    if (preceding >= 0)
      cropTop = Math.max(cropTop, Math.min(visualTop - 2, Math.ceil(preceding + 2)));
    const cropWidth = cropRight - cropLeft,
      cropHeight = cropBottom - cropTop;
    if (
      cropWidth < 58 ||
      cropHeight < 35 ||
      cropWidth > width * 0.995 ||
      cropHeight > height * 0.92 ||
      (!below && cropBottom >= caption.top - 1) ||
      (below && cropTop <= caption.bottom + 1)
    )
      return null;
    return {
      x: Math.floor(cropLeft),
      y: Math.floor(cropTop),
      width: Math.ceil(cropWidth),
      height: Math.ceil(cropHeight),
      inkTotal: totalInk
    };
  }

  /**
   * Conservative second pass for a real caption whose vector geometry is too
   * sparse, too light or mostly text to satisfy detectCrop(). The most recent
   * preceding paragraph is an upper fence; neighboring captions are hard
   * fences. Pixel bounds are measured *inside* those fences. Never silently
   * assign a different caption's artwork to a figure.
   */
  function conservativeCrop({
    data,
    width,
    height,
    boxes = [],
    caption,
    previousCaptionBottom = 0,
    nextCaptionTop = height,
    orientation = 'above'
  }) {
    if (!caption || !data || data.length < width * height * 4 || width < 90 || height < 90)
      return null;
    const below = orientation === 'below';
    let top = below
      ? Math.ceil(caption.bottom + 5)
      : Math.max(Math.floor(height * 0.025), Math.ceil(previousCaptionBottom + 6));
    let bottom = below
      ? Math.min(height - 8, Math.floor(nextCaptionTop - 6))
      : Math.floor(caption.top - 6);
    const rows = textRows(boxes);
    // The end of a paragraph near a diagram is a more reliable boundary than
    // the start of the page. Never chop a nearby panel label or axis title.
    if (!below) {
      const preceding = rows.filter(
        row => row.bottom < bottom - 34 && row.bottom >= top && isNarrativeRow(row, width)
      );
      if (preceding.length) top = Math.max(top, preceding[preceding.length - 1].bottom + 3);
    } else {
      const following = rows.find(
        row => row.top > top + 34 && row.top < bottom && isNarrativeRow(row, width)
      );
      if (following) bottom = Math.min(bottom, following.top - 4);
    }
    top = clamp(Math.floor(top), 0, height);
    bottom = clamp(Math.ceil(bottom), 0, height);
    if (bottom - top < 38) return null;
    const left = Math.floor(width * 0.035),
      right = Math.ceil(width * 0.965);
    let minX = right,
      maxX = left,
      minY = bottom,
      maxY = top,
      hits = 0;
    const sample = 1;
    for (let y = top; y < bottom; y += sample) {
      for (let x = left; x < right; x += sample) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 95 || Math.min(data[i], data[i + 1], data[i + 2]) > 246) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        hits++;
      }
    }
    // A largely white vector drawing can be thin; require spatial extent,
    // not dark-pixel density or a filled-in box.
    if (hits < 15 || maxX - minX < 40 || maxY - minY < 25) return null;
    const pad = Math.max(7, Math.round(width * 0.014));
    const x0 = clamp(minX - pad, 0, width);
    const y0 = clamp(minY - pad, top, bottom);
    const x1 = clamp(maxX + pad + sample, 0, width);
    const y1 = clamp(maxY + pad + sample, top, bottom);
    if (x1 - x0 < 55 || y1 - y0 < 34) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fallback: true };
  }

  return Object.freeze({
    textBoxes,
    textRows,
    findCaptions,
    findCaption,
    detectCrop,
    conservativeCrop,
    precedingProseBottom,
    isNarrativeRow
  });
});
