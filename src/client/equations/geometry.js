/**
 * Equation layout metadata. This module contains no PDF glyphs, content, or
 * extracted textbook graphics. Coordinates reference the user-selected PDF.
 */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasEquationGeometry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const safeLabel = label => String(label || '').trim();
  const validCrop = value =>
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    value[2] - value[0] >= 8 &&
    value[3] - value[1] >= 7 &&
    value[0] >= 0 &&
    value[1] >= 0;

  function entriesFor(manifest, label) {
    if (!manifest || !manifest.entries) return [];
    const entries = manifest.entries;
    const key = safeLabel(label);
    const current = entries[key];
    if (current && Array.isArray(current.parts)) {
      return current.parts.length >= 2 && current.parts.every(part => own(entries, part))
        ? current.parts.map(part => ({ label: part, ...entries[part] }))
        : [];
    }
    if (own(entries, key)) return [{ label: key, ...current }];
    // Support combined publisher labels only when both real components exist.
    const base = key.replace(/a,b$/, '');
    const parts = [base + 'a', base + 'b'];
    return parts.every(part => own(entries, part)) &&
      entries[parts[0]].page === entries[parts[1]].page
      ? parts.map(part => ({ label: part, ...entries[part] }))
      : [];
  }

  function cropFor(entry, pageWidth = 612, pageHeight = 792) {
    if (!entry || !validCrop(entry.crop)) return null;
    // A verified focus rectangle may trim paragraph lines that intersected
    // the original detection region. Both rectangles contain geometry only.
    const hasFocus = validCrop(entry.focus);
    const [left, top, right, bottom] = hasFocus ? entry.focus : entry.crop;
    // Keep the indexed rectangle as the standard fallback. Some exactFocus
    // rectangles deliberately stop just before neighboring prose/formulas.
    const margin = hasFocus && entry.exactFocus === true ? 0 : 0.55;
    return {
      x: Math.max(0, left - margin),
      y: Math.max(0, top - margin),
      width: Math.min(pageWidth, right + margin) - Math.max(0, left - margin),
      height: Math.min(pageHeight, bottom + margin) - Math.max(0, top - margin)
    };
  }

  /**
   * Vertical source capture guard. Capture extra source above and below the
   * indexed equation so superscripts, integral limits and deep subscripts are
   * not lost before cleanup. Expansion is still bounded by neighboring indexed
   * equations on the same page.
   */
  function guardVerticalCrop(crop, entry, peers, pageHeight, padding = 4.2, exactPadding = 1.8) {
    if (!crop || !entry || !Array.isArray(peers) || !(pageHeight > 0)) return crop;
    const extra = entry.exactFocus === true ? exactPadding : padding;
    if (!(extra > 0)) return crop;
    const x0 = crop.x,
      x1 = crop.x + crop.width;
    const y0 = crop.y,
      y1 = crop.y + crop.height;
    let top = Math.max(0, y0 - extra);
    let bottom = Math.min(pageHeight, y1 + extra);
    for (const other of peers) {
      if (!other || other === entry || other.parts) continue;
      const rect = other.focus || other.crop;
      if (!validCrop(rect) || rect[2] <= x0 || rect[0] >= x1) continue;
      if (rect[3] <= y0 && rect[3] > top - extra - 2) top = Math.max(top, rect[3] + 1.1);
      if (rect[1] >= y1 && rect[1] < bottom + extra + 2) bottom = Math.min(bottom, rect[1] - 1.1);
    }
    if (top >= y0 && bottom <= y1) return crop;
    return { x: crop.x, y: top, width: crop.width, height: bottom - top };
  }

  /**
   * Fit the complete trimmed equation to BOTH the available width and height.
   * A single uniform scale means no aspect distortion, canvas overflow, or
   * cropped subscripts. Measurements are in CSS pixels, not raster pixels.
   */
  function fitEquation(width, height, availableWidth, availableHeight, maxScale = 4) {
    if (
      ![width, height, availableWidth, availableHeight, maxScale].every(
        value => Number.isFinite(value) && value > 0
      )
    )
      return null;
    const factor = Math.min(availableWidth / width, availableHeight / height, maxScale);
    return { width: width * factor, height: height * factor, factor };
  }

  /**
   * Contain a complete equation, including separately indexed parts, inside
   * ONE fixed-size preview. Each part uses the SAME scale, so a continued
   * fraction/derivation does not become larger than its neighboring lines.
   * The vertical gap is reserved before fitting; no part can overflow the
   * frame even when the viewer is narrow. This never uses cover/crop scaling.
   */
  function fitEquationGroup(sizes, availableWidth, availableHeight, gap = 0, maxScale = 4) {
    if (
      !Array.isArray(sizes) ||
      sizes.length === 0 ||
      ![availableWidth, availableHeight, gap, maxScale].every(Number.isFinite) ||
      availableWidth <= 0 ||
      availableHeight <= 0 ||
      gap < 0 ||
      maxScale <= 0 ||
      !sizes.every(
        size =>
          size && [size.width, size.height].every(value => Number.isFinite(value) && value > 0)
      )
    )
      return null;

    const spareHeight = availableHeight - gap * (sizes.length - 1);
    if (spareHeight <= 0) return null;
    const sourceWidth = Math.max(...sizes.map(size => size.width));
    const sourceHeight = sizes.reduce((sum, size) => sum + size.height, 0);
    const factor = Math.min(availableWidth / sourceWidth, spareHeight / sourceHeight, maxScale);
    if (!(factor > 0)) return null;
    return {
      factor,
      width: sourceWidth * factor,
      height: sourceHeight * factor + gap * (sizes.length - 1),
      parts: sizes.map(size => ({
        width: size.width * factor,
        height: size.height * factor,
        factor
      }))
    };
  }

  /**
   * Sample the predominant bright paper color, rather than assuming every
   * uploaded PDF has a mathematically pure-white page. Only the local canvas
   * is examined; no content is saved or transmitted. Dark ink is excluded.
   */
  function paperColor(ctx, width, height) {
    if (width <= 0 || height <= 0) return '#ffffff';
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 3000)));
    const counts = new Map();
    let mostCommon = '#ffffff',
      largest = 0;
    for (let y = 0; y < height; y += step)
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const r = pixels[i],
          g = pixels[i + 1],
          b = pixels[i + 2];
        // A light, neutral paper background, not the equation's ink or artwork.
        if (Math.min(r, g, b) < 190 || Math.max(r, g, b) - Math.min(r, g, b) > 35) continue;
        // A bucket tolerates tiny antialiasing/compression differences.
        const key = [r, g, b]
          .map(channel => Math.min(255, Math.round(channel / 4) * 4))
          .map(channel => channel.toString(16).padStart(2, '0'))
          .join('');
        const count = (counts.get(key) || 0) + 1;
        counts.set(key, count);
        if (count > largest) {
          largest = count;
          mostCommon = '#' + key;
        }
      }
    return mostCommon;
  }

  /**
   * White out known unrelated fragments AFTER the user's PDF has been drawn.
   * Exclusions are PDF-page rectangles, not copied text or publisher artwork.
   * Each rectangle was checked against the corresponding source equation.
   */
  function removeSourceInterference(ctx, crop, scale, entry, background = '#fff') {
    if (!entry || !Array.isArray(entry.exclude)) return 0;
    if (!(scale > 0) || !crop || !Number.isFinite(crop.x) || !Number.isFinite(crop.y)) return 0;
    let removed = 0;
    ctx.fillStyle = background;
    for (const rect of entry.exclude) {
      if (!validMask(rect)) continue;
      const left = Math.max(0, Math.floor((rect[0] - crop.x) * scale));
      const top = Math.max(0, Math.floor((rect[1] - crop.y) * scale));
      const right = Math.min(Math.ceil(crop.width * scale), Math.ceil((rect[2] - crop.x) * scale));
      const bottom = Math.min(
        Math.ceil(crop.height * scale),
        Math.ceil((rect[3] - crop.y) * scale)
      );
      if (right <= left || bottom <= top) continue;
      ctx.fillRect(left, top, right - left, bottom - top);
      removed++;
    }
    return removed;
  }

  /**
   * Remove only the four strokes of known decorative frames taken from the
   * PDF drawing instructions. Full source coordinates are stored in the index
   * (no copyrighted glyphs). Unlike image-only border detection, this also
   * removes frames whose upper edge is outside the original equation crop.
   *
   * The narrowly masked strokes are not mathematical fraction bars: frame
   * metadata is generated only from four matching long exterior edges.
   */
  function removeSourceFrames(ctx, crop, scale, entry, background = '#fff') {
    if (!entry || !Array.isArray(entry.frames) || !(scale > 0) || !crop) return 0;
    ctx.save();
    ctx.fillStyle = background;
    let count = 0;
    const width = Math.ceil(crop.width * scale);
    const height = Math.ceil(crop.height * scale);
    const thickness = Math.max(1.1 * scale, 2);
    const drawStroke = (x0, y0, x1, y1) => {
      // Clip to the equation canvas and do not risk negative/huge fill regions.
      const left = Math.max(0, Math.floor(Math.min(x0, x1) - thickness / 2));
      const top = Math.max(0, Math.floor(Math.min(y0, y1) - thickness / 2));
      const right = Math.min(width, Math.ceil(Math.max(x0, x1) + thickness / 2));
      const bottom = Math.min(height, Math.ceil(Math.max(y0, y1) + thickness / 2));
      if (right > left && bottom > top) ctx.fillRect(left, top, right - left, bottom - top);
    };
    for (const frame of entry.frames) {
      if (!validMask(frame)) continue;
      const [left, top, right, bottom] = frame;
      const xl = (left - crop.x) * scale;
      const xr = (right - crop.x) * scale;
      const yt = (top - crop.y) * scale;
      const yb = (bottom - crop.y) * scale;
      if (xr < 0 || xl > width || yb < 0 || yt > height) continue;
      drawStroke(xl, yt, xr, yt);
      drawStroke(xl, yb, xr, yb);
      drawStroke(xl, yt, xl, yb);
      drawStroke(xr, yt, xr, yb);
      count++;
    }
    ctx.restore();
    return count;
  }

  function validMask(rect) {
    return (
      Array.isArray(rect) &&
      rect.length === 4 &&
      rect.every(Number.isFinite) &&
      rect[2] > rect[0] &&
      rect[3] > rect[1] &&
      rect[0] >= 0 &&
      rect[1] >= 0
    );
  }

  /**
   * Discard isolated horizontal border fragments at the outermost edges of a
   * crop. The check deliberately avoids the interior, where fraction bars,
   * radical overbars, reaction arrows, and matrix rules are meaningful.
   */
  function removePeripheralRules(ctx, width, height, background = '#fff') {
    if (width < 90 || height < 40) return 0;
    const img = ctx.getImageData(0, 0, width, height).data;
    const dark = (x, y) => {
      const i = (y * width + x) * 4;
      return img[i] < 135 && img[i + 1] < 135 && img[i + 2] < 135;
    };
    const inset = Math.max(2, Math.floor(height * 0.08));
    const search = [
      [0, inset],
      [height - inset, height]
    ];
    let removed = 0;
    for (const [top, bottom] of search) {
      let run = null;
      for (let y = top; y < bottom; y++) {
        let begin = -1,
          end = -1,
          total = 0;
        for (let x = 0; x < width; x++)
          if (dark(x, y)) {
            if (begin < 0) begin = x;
            end = x;
            total++;
          }
        if (begin < 0 || end - begin < width * 0.83 || total < (end - begin + 1) * 0.9) continue;
        // A line exactly at the edge is an outer graphic frame/rule; a fraction
        // line requires enough vertical room for both operands, so is interior.
        run = { start: begin, end, y };
        break;
      }
      if (!run) continue;
      ctx.fillStyle = background;
      const thickness = Math.max(2, Math.min(4, Math.ceil(height * 0.012)));
      ctx.fillRect(run.start - 1, run.y - thickness, run.end - run.start + 3, thickness * 2 + 1);
      removed++;
    }
    return removed;
  }

  /**
   * Trim transparent/background-only space on all four sides, retaining ALL
   * detected source ink, including isolated decimal points and overbars. A
   * margin is added AFTER finding the bounds; mathematically meaningful
   * detached strokes are never discarded by a connected-component filter.
   *
   * The background may be tinted by the PDF. Compare to the sampled paper
   * color rather than to a hard-coded RGB=255 threshold.
   */

  function paperRGB(background) {
    const match = /^#([a-f0-9]{6})$/i.exec(background || '');
    return match
      ? [1, 3, 5].map(offset => parseInt(match[1].slice(offset - 1, offset + 1), 16))
      : [255, 255, 255];
  }

  function analyzeInkRows(ctx, width, height, background = '#ffffff') {
    if (width <= 0 || height <= 0) return null;
    const paper = paperRGB(background);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const counts = new Array(height).fill(0);
    const mins = new Array(height).fill(width);
    const maxs = new Array(height).fill(-1);
    for (let y = 0; y < height; y++) {
      let count = 0;
      let minX = width;
      let maxX = -1;
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = rowOffset + x * 4;
        if (
          Math.max(
            Math.abs(pixels[i] - paper[0]),
            Math.abs(pixels[i + 1] - paper[1]),
            Math.abs(pixels[i + 2] - paper[2])
          ) < 13
        )
          continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
      counts[y] = count;
      mins[y] = minX;
      maxs[y] = maxX;
    }
    return { counts, mins, maxs };
  }

  function rowBandsFromAnalysis(analysis, width, height, bridge = 2) {
    if (!analysis) return [];
    const { counts, mins, maxs } = analysis;
    const bands = [];
    for (let y = 0; y < height; ) {
      while (y < height && counts[y] <= 0) y++;
      if (y >= height) break;
      const start = y;
      let top = y;
      let bottom = y;
      let gap = 0;
      let total = 0;
      let left = width;
      let right = -1;
      while (y < height) {
        if (counts[y] > 0) {
          gap = 0;
          bottom = y;
          total += counts[y];
          if (mins[y] < left) left = mins[y];
          if (maxs[y] > right) right = maxs[y];
          y++;
          continue;
        }
        gap++;
        if (gap > bridge) break;
        y++;
      }
      if (right >= left) {
        bands.push({
          top,
          bottom,
          total,
          left,
          right,
          width: right - left + 1,
          centerX: (left + right) / 2,
          centerY: (top + bottom) / 2
        });
      }
      y = Math.max(y, start + 1);
    }
    return bands;
  }

  function overlap1D(a0, a1, b0, b1) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
  }

  function bandAlignedWithUnion(band, unionLeft, unionRight) {
    const overlap = overlap1D(band.left, band.right, unionLeft, unionRight);
    const smaller = Math.max(1, Math.min(band.width, unionRight - unionLeft + 1));
    if (overlap >= smaller * 0.18) return true;
    const unionCenter = (unionLeft + unionRight) / 2;
    return Math.abs(band.centerX - unionCenter) <= Math.max(18, smaller * 0.95);
  }

  /**
   * Choose the vertical band that belongs to the equation itself, not nearby
   * prose or labels. The caller may render a slightly generous source crop;
   * this function keeps the equation band and rejects unrelated content above
   * or below it without trimming real mathematical ink.
   */
  function selectVerticalInkWindow(ctx, width, height, anchor = null, background = '#ffffff') {
    const analysis = analyzeInkRows(ctx, width, height, background);
    const bands = rowBandsFromAnalysis(
      analysis,
      width,
      height,
      Math.max(2, Math.min(5, Math.round(height * 0.012)))
    );
    if (!bands.length) return null;
    const anchorTop = Number.isFinite(anchor?.top) ? Math.max(0, Math.floor(anchor.top)) : 0;
    const anchorBottom = Number.isFinite(anchor?.bottom)
      ? Math.min(height - 1, Math.ceil(anchor.bottom))
      : height - 1;
    const anchorCenter = (anchorTop + anchorBottom) / 2;
    const overlapIndices = [];
    for (let i = 0; i < bands.length; i++) {
      if (overlap1D(bands[i].top, bands[i].bottom, anchorTop, anchorBottom) > 0)
        overlapIndices.push(i);
    }
    let keep = overlapIndices;
    if (!keep.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < bands.length; i++) {
        const band = bands[i];
        const score =
          band.total - Math.abs(band.centerY - anchorCenter) * Math.max(6, band.width * 0.25);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      keep = [bestIndex];
    }
    keep = [...new Set(keep)].sort((a, b) => a - b);
    let topIndex = keep[0];
    let bottomIndex = keep[keep.length - 1];
    let unionLeft = Math.min(...keep.map(index => bands[index].left));
    let unionRight = Math.max(...keep.map(index => bands[index].right));
    const maxGap =
      anchor?.isReference === true
        ? Math.max(10, Math.min(20, Math.round((anchorBottom - anchorTop + 1) * 0.3)))
        : Math.max(5, Math.min(18, Math.round((anchorBottom - anchorTop + 1) * 0.3)));
    for (let i = topIndex - 1; i >= 0; i--) {
      const gap = bands[topIndex].top - bands[i].bottom - 1;
      if (gap > maxGap || !bandAlignedWithUnion(bands[i], unionLeft, unionRight)) break;
      keep.unshift(i);
      topIndex = i;
      unionLeft = Math.min(unionLeft, bands[i].left);
      unionRight = Math.max(unionRight, bands[i].right);
    }
    for (let i = bottomIndex + 1; i < bands.length; i++) {
      const gap = bands[i].top - bands[bottomIndex].bottom - 1;
      if (gap > maxGap || !bandAlignedWithUnion(bands[i], unionLeft, unionRight)) break;
      keep.push(i);
      bottomIndex = i;
      unionLeft = Math.min(unionLeft, bands[i].left);
      unionRight = Math.max(unionRight, bands[i].right);
    }
    return {
      top: bands[topIndex].top,
      bottom: bands[bottomIndex].bottom,
      left: unionLeft,
      right: unionRight,
      bands: keep.map(index => bands[index])
    };
  }

  /**
   * The original PDF has a printed equation number at the right-hand margin.
   * Its vertical position identifies the equation without trusting a rough
   * source rectangle (which may include prose above or the following formula).
   * Nearest numbered peers set conservative half-way limits for tightly stacked
   * formulas. This is numeric geometry, never extracted book content.
   */
  function equationReferenceWindow(entry, peers, crop, scale) {
    if (!entry || !crop || !(scale > 0)) return null;
    const bounds =
      Array.isArray(entry.anchorY) &&
      entry.anchorY.length === 2 &&
      entry.anchorY.every(Number.isFinite) &&
      entry.anchorY[1] > entry.anchorY[0]
        ? entry.anchorY
        : null;
    if (!bounds) return null;
    const center = (bounds[0] + bounds[1]) / 2;
    let closestBefore = null,
      closestAfter = null;
    for (const other of peers || []) {
      if (
        !other ||
        other === entry ||
        !Array.isArray(other.anchorY) ||
        other.anchorY.length !== 2 ||
        !other.anchorY.every(Number.isFinite)
      )
        continue;
      const otherCenter = (other.anchorY[0] + other.anchorY[1]) / 2;
      const delta = otherCenter - center;
      if (delta < -0.5 && (!closestBefore || otherCenter > closestBefore))
        closestBefore = otherCenter;
      if (delta > 0.5 && (!closestAfter || otherCenter < closestAfter)) closestAfter = otherCenter;
    }
    const margin = 0.5; // half a PDF point of protection around boundaries
    const minY =
      closestBefore === null ? 0 : ((closestBefore + center) / 2 + margin - crop.y) * scale;
    const maxY =
      closestAfter === null ? Infinity : ((closestAfter + center) / 2 - margin - crop.y) * scale;
    return {
      top: (bounds[0] - crop.y) * scale,
      bottom: (bounds[1] - crop.y) * scale,
      minY,
      maxY,
      isReference: true
    };
  }

  function removeVerticalEncroachment(ctx, width, height, anchor = null, background = '#ffffff') {
    if (!anchor) return null;
    const analysis = analyzeInkRows(ctx, width, height, background);
    const counts = analysis?.counts;
    // When two printed equations are exceptionally close, shift the midpoint
    // separator to a nearby low-ink row to avoid shaving small descendants.
    const pickCut = target => {
      if (!Number.isFinite(target)) return target;
      const original = Math.round(target);
      const window = Math.max(3, Math.min(9, Math.round(height * 0.025)));
      let cut = original,
        best = Infinity;
      for (
        let y = Math.max(0, original - window);
        y <= Math.min(height - 1, original + window);
        y++
      ) {
        const ink = counts?.[y] ?? 0;
        const score = ink * 5 + Math.abs(y - original) * 0.18;
        if (score < best) {
          best = score;
          cut = y;
        }
      }
      return cut;
    };
    const minLimit = Math.max(0, Number.isFinite(anchor.minY) ? pickCut(anchor.minY) : 0);
    const maxLimit = Math.min(
      height - 1,
      Number.isFinite(anchor.maxY) ? pickCut(anchor.maxY) : height - 1
    );
    if (minLimit >= maxLimit) return null;

    const inside = {
      ...anchor,
      top: Math.max(anchor.top, minLimit),
      bottom: Math.min(anchor.bottom, maxLimit)
    };
    if (inside.bottom <= inside.top) return null;
    // Prevent adjacent numbered equations from seeding the ink-band selection.
    // Different PDF text runs are often less than one font ascent apart.
    const window = selectVerticalInkWindow(ctx, width, height, inside, background);
    if (!window) return null;
    const top = Math.min(maxLimit, Math.max(minLimit, window.top));
    const bottom = Math.max(minLimit, Math.min(maxLimit, window.bottom));
    if (bottom <= top) return null;
    ctx.fillStyle = background;
    if (top > 0) ctx.fillRect(0, 0, width, top);
    if (bottom < height - 1) ctx.fillRect(0, bottom + 1, width, height - bottom - 1);
    return { ...window, top, bottom };
  }

  function inkBounds(ctx, width, height, padding = 4, background = '#ffffff') {
    if (width <= 0 || height <= 0) return null;
    const match = /^#([a-f0-9]{6})$/i.exec(background);
    const paper = match
      ? [1, 3, 5].map(offset => parseInt(match[1].slice(offset - 1, offset + 1), 16))
      : [255, 255, 255];
    const pixels = ctx.getImageData(0, 0, width, height).data;
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = 4 * (y * width + x);
        // Detect even faint antialiased strokes, but ignore tiny differences
        // from the actual PDF paper tone.
        if (
          Math.max(
            Math.abs(pixels[i] - paper[0]),
            Math.abs(pixels[i + 1] - paper[1]),
            Math.abs(pixels[i + 2] - paper[2])
          ) < 13
        )
          continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < 0) return null;
    const requestedX = typeof padding === 'number' ? padding : padding?.x;
    const requestedY = typeof padding === 'number' ? padding : padding?.y;
    const padX = Number.isFinite(requestedX) ? Math.max(0, Math.ceil(requestedX)) : 0;
    const padY = Number.isFinite(requestedY) ? Math.max(0, Math.ceil(requestedY)) : 0;
    const x = Math.max(0, minX - padX),
      y = Math.max(0, minY - padY);
    return {
      x,
      y,
      width: Math.min(width, maxX + padX + 1) - x,
      height: Math.min(height, maxY + padY + 1) - y
    };
  }

  // Detect a narrow, nearly full-length axis-aligned rectangle from the
  // selected source region. This is never used to erase mathematical content:
  // a border is removed only when ALL FOUR matching edges are observed.
  function frameEdges(imageData, width, height) {
    if (width < 55 || height < 24) return null;
    const ink = (x, y) => {
      const i = 4 * (y * width + x);
      const a = imageData[i + 3] / 255;
      return (
        a > 0.45 && imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114 < 145
      );
    };
    const topRows = Math.min(Math.floor(height * 0.19), 32);
    const sideCols = Math.min(Math.floor(width * 0.18), 35);
    const candidateRow = (top, bottom) => {
      let chosen = null;
      for (let y = top; y < bottom; y++) {
        let x1 = -1,
          x2 = -1,
          count = 0;
        for (let x = 0; x < width; x++)
          if (ink(x, y)) {
            if (x1 < 0) x1 = x;
            x2 = x;
            count++;
          }
        if (x1 < 0 || x2 - x1 < width * 0.72 || count < 0.66 * (x2 - x1)) continue;
        const current = { y, x1, x2, count };
        if (!chosen || current.count > chosen.count) chosen = current;
      }
      return chosen;
    };
    const t = candidateRow(0, topRows);
    const b = candidateRow(height - topRows, height);
    if (!t || !b || b.y - t.y < height * 0.52) return null;
    if (Math.abs(t.x1 - b.x1) > sideCols || Math.abs(t.x2 - b.x2) > sideCols) return null;
    let leftX = -1,
      rightX = -1,
      leftScore = 0,
      rightScore = 0;
    const y1 = t.y,
      y2 = b.y,
      span = y2 - y1;
    const scanColumn = (start, stop, left) => {
      let best = [-1, 0];
      for (let x = Math.max(0, start); x <= Math.min(width - 1, stop); x++) {
        let count = 0;
        for (let y = y1; y <= y2; y++) if (ink(x, y)) count++;
        if (count > best[1]) best = [x, count];
      }
      return best;
    };
    [leftX, leftScore] = scanColumn(t.x1 - 4, t.x1 + 4);
    [rightX, rightScore] = scanColumn(t.x2 - 4, t.x2 + 4);
    if (leftScore < span * 0.62 || rightScore < span * 0.62) return null;
    return { top: t.y, bottom: b.y, left: leftX, right: rightX };
  }

  function removeDecorativeFrame(ctx, width, height, background = '#fff') {
    // Clean the exact PDF pixels only when the stroke can be identified as a
    // complete outer frame. Fractions, square-root bars and reaction arrows
    // must not be touched.
    const image = ctx.getImageData(0, 0, width, height);
    const frame = frameEdges(image.data, width, height);
    if (!frame) return false;
    ctx.fillStyle = background;
    const pad = 2;
    ctx.fillRect(
      frame.left - pad,
      frame.top - pad,
      frame.right - frame.left + pad * 2 + 1,
      pad * 2 + 1
    );
    ctx.fillRect(
      frame.left - pad,
      frame.bottom - pad,
      frame.right - frame.left + pad * 2 + 1,
      pad * 2 + 1
    );
    ctx.fillRect(
      frame.left - pad,
      frame.top - pad,
      pad * 2 + 1,
      frame.bottom - frame.top + pad * 2 + 1
    );
    ctx.fillRect(
      frame.right - pad,
      frame.top - pad,
      pad * 2 + 1,
      frame.bottom - frame.top + pad * 2 + 1
    );
    return true;
  }
  return Object.freeze({
    entriesFor,
    cropFor,
    guardVerticalCrop,
    fitEquation,
    fitEquationGroup,
    paperColor,
    frameEdges,
    removeDecorativeFrame,
    removeSourceFrames,
    removeSourceInterference,
    removePeripheralRules,
    inkBounds,
    selectVerticalInkWindow,
    removeVerticalEncroachment,
    equationReferenceWindow
  });
});
