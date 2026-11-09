const test = require('node:test');
const assert = require('node:assert/strict');
const {
  entriesFor,
  cropFor,
  frameEdges,
  removeDecorativeFrame,
  removeSourceFrames,
  removeSourceInterference,
  removePeripheralRules,
  inkBounds,
  selectVerticalInkWindow,
  removeVerticalEncroachment,
  guardVerticalCrop
} = require('../../src/client/equations/geometry.js');
const map = {
  entries: {
    '1.1.1': { page: 58, crop: [80, 400, 220, 425] },
    '1.1.2a': { page: 58, crop: [80, 430, 170, 450] },
    '1.1.2b': { page: 58, crop: [80, 455, 170, 475] },
    '1.1.2a,b': { page: 58, parts: ['1.1.2a', '1.1.2b'] }
  }
};
test('look up one or several real equations without source graphics', () => {
  assert.deepEqual(
    entriesFor(map, '1.1.1').map(e => e.label),
    ['1.1.1']
  );
  assert.deepEqual(
    entriesFor(map, '1.1.2a,b').map(e => e.label),
    ['1.1.2a', '1.1.2b']
  );
  assert.deepEqual(entriesFor(map, 'bad'), []);
});
test('crop bounds include small margins but never extend beyond PDF page', () => {
  const crop = cropFor({ crop: [80, 400, 220, 425] });
  assert.ok(Math.abs(crop.x - 79.45) < 0.001 && Math.abs(crop.y - 399.45) < 0.001);
  assert.ok(Math.abs(crop.width - 141.1) < 0.001 && Math.abs(crop.height - 26.1) < 0.001);
  assert.equal(cropFor({ crop: [1, 2, 3, 4] }), null);
});
function canvas(width, height, segments) {
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = 255;
    bytes[i + 1] = 255;
    bytes[i + 2] = 255;
    bytes[i + 3] = 255;
  }
  for (const [x0, y0, x1, y1] of segments)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        bytes[i] = bytes[i + 1] = bytes[i + 2] = 0;
      }
  return bytes;
}
test('outer box lines can be identified without treating a fraction as a frame', () => {
  const box = canvas(180, 80, [
    [10, 5, 166, 6],
    [10, 73, 166, 74],
    [10, 5, 11, 74],
    [165, 5, 166, 74],
    [70, 35, 124, 35]
  ]);
  const detected = frameEdges(box, 180, 80);
  assert.ok(detected, 'four-sided outer frame should be found');
  assert.ok(detected.left <= 11 && detected.right >= 165);
  const fraction = canvas(180, 80, [
    [33, 40, 160, 41],
    [75, 20, 85, 30],
    [60, 50, 75, 65]
  ]);
  assert.equal(frameEdges(fraction, 180, 80), null);
  const masked = [];
  const fakeCtx = {
    getImageData: () => ({ data: box }),
    fillRect: (...args) => masked.push(args),
    set fillStyle(value) {}
  };
  assert.equal(removeDecorativeFrame(fakeCtx, 180, 80), true);
  assert.equal(masked.length, 4);
});

test('verified focus coordinates override broad extraction bounds', () => {
  const entry = { crop: [55, 100, 325, 195], focus: [75, 125, 295, 160] };
  const rect = cropFor(entry, 500, 720);
  assert.equal(Math.round(rect.y), 124);
  assert.ok(rect.height < 40);
});

test('source masks are clipped to the equation region and ignore invalid coordinates', () => {
  const filled = [];
  const ctx = { set fillStyle(c) {}, fillRect: (...args) => filled.push(args) };
  const region = { x: 60, y: 100, width: 130, height: 40 };
  const entry = {
    exclude: [
      [50, 90, 78, 110], // partially inside
      [100, 125, 125, 140],
      [400, 400, 450, 450],
      [-1, 0, 20, 50]
    ]
  };
  assert.equal(removeSourceInterference(ctx, region, 2, entry), 2);
  assert.deepEqual(filled[0], [0, 0, 36, 20]);
  assert.deepEqual(filled[1], [80, 50, 50, 30]);
});

test('peripheral border rule disappears while the interior fraction survives', () => {
  const w = 180,
    h = 80;
  const pixels = canvas(w, h, [
    [5, 3, 174, 4],
    [62, 38, 113, 39],
    [74, 19, 86, 29],
    [77, 48, 91, 61]
  ]);
  const fills = [];
  const ctx = {
    getImageData: () => ({ data: pixels }),
    fillRect: (...args) => fills.push(args),
    set fillStyle(v) {}
  };
  assert.equal(removePeripheralRules(ctx, w, h), 1);
  assert.ok(fills[0][1] < 10);
  assert.ok(fills.every(([, y, , ,]) => y < 10));
  const onlyFraction = canvas(w, h, [
    [62, 38, 113, 39],
    [74, 19, 86, 29],
    [77, 48, 91, 61]
  ]);
  const empty = [];
  assert.equal(
    removePeripheralRules(
      {
        getImageData: () => ({ data: onlyFraction }),
        fillRect: (...r) => empty.push(r),
        set fillStyle(_) {}
      },
      w,
      h
    ),
    0
  );
  assert.equal(empty.length, 0);
});

test('ink bounds exclude white margins but never cut glyph pixels', () => {
  const w = 120,
    h = 65;
  const image = canvas(w, h, [[22, 18, 80, 39]]);
  const ctx = { getImageData: () => ({ data: image }) };
  assert.deepEqual(inkBounds(ctx, w, h, 3), { x: 19, y: 15, width: 65, height: 28 });
  const white = canvas(w, h, []);
  assert.equal(inkBounds({ getImageData: () => ({ data: white }) }, w, h), null);
});

const completeSourceMap = require('../../src/client/equations/source-map.json');
test('geometry catalog contains verified coordinates but no copied book content', () => {
  const entries = completeSourceMap.entries;
  assert.equal(Object.keys(entries).length, 2004);
  assert.match(completeSourceMap.pdf_sha256, /^[a-f0-9]{64}$/);
  let maskedEntries = 0;
  for (const [id, entry] of Object.entries(entries)) {
    if (entry.parts) {
      assert.ok(
        entry.parts.every(part => entries[part]),
        `invalid composite ${id}`
      );
      continue;
    }
    assert.ok(Number.isInteger(entry.page) && entry.page >= 1 && entry.page <= 1107, id);
    assert.ok(
      Array.isArray(entry.crop) && entry.crop.length === 4 && entry.crop.every(Number.isFinite),
      `${id}: invalid crop`
    );
    assert.ok(
      entry.crop[0] >= 0 &&
        entry.crop[1] >= 0 &&
        entry.crop[2] > entry.crop[0] &&
        entry.crop[3] > entry.crop[1],
      id
    );
    if (entry.focus) {
      assert.ok(
        entry.focus.length === 4 &&
          entry.focus.every(Number.isFinite) &&
          entry.focus[2] > entry.focus[0] &&
          entry.focus[3] > entry.focus[1],
        id
      );
    }
    if (entry.exclude) {
      maskedEntries++;
      for (const rect of entry.exclude) {
        assert.equal(rect.length, 4, `${id}: mask dimension`);
        assert.ok(rect.every(Number.isFinite), `${id}: mask must be numeric`);
        assert.ok(
          rect[0] >= 0 && rect[1] >= 0 && rect[2] > rect[0] && rect[3] > rect[1],
          `${id}: invalid mask bounds`
        );
      }
    }
    assert.ok(
      !Object.keys(entry).some(key => /(?:svg|image|glyph|text|html|base64)/i.test(key)),
      `${id}: embedded source content`
    );
  }
  assert.ok(
    maskedEntries > 150,
    'verified source masks must be present for difficult equation layouts'
  );
  assert.ok(
    entries['3.7.23'].focus[3] > entries['3.7.23'].crop[3],
    'the tall framed equation must not be cropped before its lower border'
  );
});

test('known PDF frame strokes are erased even when top border is cropped out', () => {
  const manifest = require('../../src/client/equations/source-map.json');
  const entry = manifest.entries['1.3.7'];
  assert.equal(entry.page, 82);
  assert.deepEqual(entry.frames, [[83.67, 345.46, 210.51, 371.6]]);
  const crop = cropFor(entry, 504.57, 720);
  assert.ok(crop.y > entry.frames[0][1], 'frame top is outside the visual crop');
  const painted = [];
  const ctx = {
    save() {},
    restore() {},
    set fillStyle(_) {},
    fillRect: (...rect) => painted.push(rect)
  };
  assert.equal(removeSourceFrames(ctx, crop, 3.5, entry), 1);
  assert.ok(painted.length >= 3, 'visible side and bottom strokes must be removed');
  const fractionX = Math.floor((96 - crop.x) * 3.5);
  const fractionY = Math.floor((358.74 - crop.y) * 3.5);
  const touches = (x, y) =>
    painted.some(
      ([left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height
    );
  assert.equal(touches(fractionX, fractionY), false, 'fraction bar must not be erased');
  const frameBottomX = Math.floor((146 - crop.x) * 3.5);
  const frameBottomY = Math.floor((371.6 - crop.y) * 3.5);
  assert.equal(touches(frameBottomX, frameBottomY), true, 'bottom frame stroke must be erased');
});

test('Fe(III)/Fe(II) equation crop includes entire formula and excludes footnote lead-in', () => {
  const entry = require('../../src/client/equations/source-map.json').entries['1.1.24'];
  assert.equal(entry.page, 71);
  const c = cropFor(entry, 504.57, 720);
  assert.ok(c.x > 80 && c.y > 589 && c.x + c.width > 320.55);
  assert.ok(c.y + c.height >= 605.73, 'full original equation visible');
  assert.ok(c.x > 76.48, 'footnote 18 and as lead-in excluded');
});

test('the geometry catalog records matched page-vector frames with no glyph data', () => {
  const entries = require('../../src/client/equations/source-map.json').entries;
  let count = 0;
  for (const [label, entry] of Object.entries(entries)) {
    for (const frame of entry.frames || []) {
      assert.ok(frame.length === 4 && frame.every(Number.isFinite), label);
      assert.ok(frame[2] - frame[0] >= 35 && frame[3] - frame[1] >= 12, label);
      assert.ok(frame[0] >= 0 && frame[1] >= 0 && frame[2] <= 505 && frame[3] <= 720, label);
      count++;
    }
  }
  assert.equal(count, 383);
});

test('verified tight source bounds do not add margins or reintroduce adjacent content', () => {
  const entries = completeSourceMap.entries;
  const current = cropFor(entries['1.3.19'], 504.57, 720);
  const followingFrame = entries['1.3.20'].frames[0];
  assert.equal(current.y + current.height, 418.55);
  assert.ok(
    current.y + current.height < followingFrame[1],
    'Equation 1.3.19 must end before the upper border of Equation 1.3.20'
  );
  assert.ok(
    current.y < 389.27 && current.y + current.height > 418.4,
    'the numerator and denominator must stay in view'
  );

  const massTransfer = cropFor(entries['1.3.1'], 504.57, 720);
  assert.ok(
    massTransfer.y > 202.31,
    'the reference to Equation 1.1.15 and footnote 27 must be outside the preview'
  );
  assert.ok(
    massTransfer.y < 209.7 && massTransfer.y + massTransfer.height > 223.6,
    'the formula and its sign-convention note must remain visible'
  );
  assert.equal(
    entries['1.3.1'].exclude,
    undefined,
    'obsolete masks for the previous paragraph must not survive the tighter crop'
  );

  const charging = cropFor(entries['6.6.7'], 504.57, 720);
  const nextFrame = entries['6.6.8'].frames[0];
  assert.ok(
    charging.y + charging.height < nextFrame[1],
    'Equation 6.6.7 must not include the border of Equation 6.6.8'
  );
});

test('standalone equation previews never intrude substantially into a following boxed equation', () => {
  const byPage = new Map();
  for (const [id, entry] of Object.entries(completeSourceMap.entries)) {
    // Combined publisher labels are virtual index entries for paired formulas.
    if (!entry.crop || entry.parts || id.endsWith('a,b')) continue;
    if (!byPage.has(entry.page)) byPage.set(entry.page, []);
    byPage.get(entry.page).push([id, entry]);
  }
  for (const [, items] of byPage) {
    items.sort((a, b) => a[1].crop[1] - b[1].crop[1]);
    for (let i = 0; i < items.length; i++) {
      const [label, entry] = items[i];
      const bounds = cropFor(entry, 504.57, 720);
      for (const [nextLabel, nextEntry] of items.slice(i + 1, i + 3)) {
        for (const frame of nextEntry.frames || []) {
          if (frame[1] < bounds.y || frame[1] > bounds.y + bounds.height) continue;
          const overlap = bounds.y + bounds.height - frame[1];
          assert.ok(
            overlap < 0.4,
            `${label} extends ${overlap.toFixed(2)} pt into ${nextLabel}'s outer frame`
          );
        }
      }
    }
  }
});

test('Chapter 1 formulas are isolated from the neighboring narrative', () => {
  const entries = completeSourceMap.entries;
  const reaction = cropFor(entries['1.4.1'], 504.57, 720);
  assert.ok(reaction.x >= 82 && reaction.y >= 344);
  assert.ok(reaction.height <= 16, 'reaction 1.4.1 must exclude the lead-in and footnote');

  const mass = cropFor(entries['1.4.6'], 504.57, 720);
  assert.ok(mass.x >= 82 && mass.x + mass.width < 214);
  assert.ok(
    mass.y >= 580 && mass.y + mass.height <= 606.5,
    'reaction 1.4.6 must exclude the sentence and superscript artifacts above it'
  );

  const partLabels = entriesFor(completeSourceMap, '3.1.13').map(e => e.label);
  assert.deepEqual(
    partLabels,
    ['3.1.13a', '3.1.13b'],
    'the unlettered reference must show its two actual source formulas'
  );
});

test('closely spaced boxed equations mask only neighboring frame strokes', () => {
  const entries = completeSourceMap.entries;
  for (const label of ['17.2.27', '17.2.28']) {
    const entry = entries[label];
    const bounds = cropFor(entry, 504.57, 720);
    assert.ok(Array.isArray(entry.exclude) && entry.exclude.length > 0, label);
    const masks = entry.exclude.filter(
      m => m[1] >= bounds.y - 8 && m[1] <= bounds.y + bounds.height
    );
    assert.ok(masks.length > 0, `${label} should remove overlapping border strokes`);
  }
});

test('vertical equation window removes nearby prose while keeping detached math rows', () => {
  const width = 160,
    height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  };
  // prose above and below
  paint(8, 4, 148, 7);
  paint(5, 79, 150, 82);
  // main equation with a raised row and a lowered row separated by small gaps
  paint(70, 18, 95, 20);
  paint(30, 26, 130, 32);
  paint(58, 38, 103, 41);
  const ctx = {
    getImageData: () => ({ data }),
    set fillStyle(v) {},
    fillRect(x, y, w, h) {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const i = (yy * width + xx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 255;
        }
    }
  };
  const window = selectVerticalInkWindow(ctx, width, height, { top: 24, bottom: 40 }, '#ffffff');
  assert.ok(window.top <= 18 && window.bottom >= 41, 'must keep detached math rows');
  assert.ok(window.top > 7 && window.bottom < 79, 'must reject prose rows');
  removeVerticalEncroachment(ctx, width, height, { top: 24, bottom: 40 }, '#ffffff');
  const bounds = inkBounds(ctx, width, height, { x: 1, y: 1 }, '#ffffff');
  assert.ok(bounds.y <= 18 && bounds.y + bounds.height - 1 >= 41);
  assert.ok(bounds.y > 7 && bounds.y + bounds.height - 1 < 79);
});

test('vertical guard can slightly expand even exact-focus crops without crossing peers', () => {
  const exact = {
    page: 1,
    crop: [70, 120, 240, 156],
    focus: [90, 126, 230, 153],
    exactFocus: true
  };
  const exactCrop = cropFor(exact, 612, 792);
  const widened = guardVerticalCrop(exactCrop, exact, [], 792);
  assert.ok(widened.y <= exactCrop.y);
  assert.ok(widened.y + widened.height >= exactCrop.y + exactCrop.height);
  const peers = [
    { page: 1, crop: [92, 116, 228, 125.5] },
    { page: 1, crop: [92, 153.5, 228, 163] }
  ];
  const constrained = guardVerticalCrop(exactCrop, exact, peers, 792);
  assert.ok(constrained.y >= exactCrop.y);
  assert.ok(constrained.y + constrained.height <= exactCrop.y + exactCrop.height);
});
