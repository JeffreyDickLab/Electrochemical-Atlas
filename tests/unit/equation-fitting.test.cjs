'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cropFor,
  guardVerticalCrop,
  fitEquation,
  fitEquationGroup,
  paperColor,
  inkBounds,
  removeSourceInterference,
  removeSourceFrames
} = require('../../src/client/equations/geometry.js');

function bitmap(w, h, rgb = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let n = 0; n < data.length; n += 4) {
    [data[n], data[n + 1], data[n + 2], data[n + 3]] = [...rgb, 255];
  }
  const stroke = (x, y, c = [0, 0, 0]) => {
    const i = (y * w + x) * 4;
    [data[i], data[i + 1], data[i + 2]] = c;
  };
  return { data, stroke, getImageData: () => ({ data }) };
}

test('full source content fits both width and height with a uniform scale', () => {
  for (const [w, h, availableW, availableH, maxZoom] of [
    [410, 22, 400, 210, 4], // long single-line formula
    [45, 220, 400, 210, 4], // narrow seven-line formula
    [220, 220, 400, 210, 4], // square multi-line expression
    [9, 15, 400, 210, 4], // short isolated symbol
    [580, 175, 225, 160, 5], // phone width
    [325, 60, 780, 450, 5] // wide detail preview
  ]) {
    const fitted = fitEquation(w, h, availableW, availableH, maxZoom);
    assert.ok(fitted.width <= availableW + 1e-10 && fitted.height <= availableH + 1e-10);
    assert.ok(fitted.factor <= maxZoom);
    assert.ok(
      Math.abs(fitted.width / fitted.height - w / h) < 1e-9,
      'no stretching, cover or hidden fractions'
    );
  }
  assert.equal(fitEquation(0, 20, 400, 160), null);
  assert.equal(fitEquation(80, 40, 0, 160), null);
});

test('paper color matches the actual PDF background rather than hard-coded white', () => {
  const img = bitmap(100, 75, [248, 244, 236]);
  for (let y = 12; y < 47; y++) for (let x = 18; x < 25; x++) img.stroke(x, y);
  assert.equal(paperColor(img, 100, 75), '#f8f4ec');
  const plain = bitmap(30, 20);
  assert.equal(paperColor(plain, 30, 20), '#ffffff');
});

test('four-sided content zoom preserves isolated ink, fraction marks and edge labels', () => {
  const w = 160,
    h = 95,
    bg = '#f8f4ec';
  const img = bitmap(w, h, [248, 244, 236]);
  // Put a superscript, thin overbar, long fraction, and an isolated period at
  // separate extremes. None may be filtered as a speck or a decorative rule.
  img.stroke(7, 9);
  for (let x = 30; x < 147; x++) img.stroke(x, 18);
  for (let x = 40; x < 131; x++) img.stroke(x, 49);
  img.stroke(150, 85);
  assert.deepEqual(inkBounds(img, w, h, 3, bg), { x: 4, y: 6, width: 150, height: 83 });
  const blank = bitmap(w, h, [248, 244, 236]);
  assert.equal(inkBounds(blank, w, h, 3, bg), null);
});

test('tight independent vertical margin retains top and bottom mathematical ink', () => {
  const w = 140,
    h = 68,
    bg = '#f8f4ec';
  const img = bitmap(w, h, [248, 244, 236]);
  // A raised minus sign / overbar at y=9 and a descending index at y=58.
  // Horizontal safety margin is unchanged, but only two pixels are added
  // above/below source ink.
  img.stroke(15, 9);
  img.stroke(123, 58);
  for (let x = 40; x < 105; x++) img.stroke(x, 31);
  const tight = inkBounds(img, w, h, { x: 10, y: 2 }, bg);
  const former = inkBounds(img, w, h, 10, bg);
  assert.deepEqual(tight, { x: 5, y: 7, width: 129, height: 54 });
  assert.ok(tight.height < former.height);
  assert.equal(tight.x, former.x);
  assert.equal(tight.width, former.width);
  // The content at either vertical extremity remains in the crop.
  assert.ok(9 >= tight.y && 9 < tight.y + tight.height);
  assert.ok(58 >= tight.y && 58 < tight.y + tight.height);
  assert.deepEqual(inkBounds(img, w, h, { x: 10, y: 0 }, bg), {
    x: 5,
    y: 9,
    width: 129,
    height: 50
  });
});

test('all preview frames use the same fixed height, including while loading', () => {
  const fs = require('node:fs');
  const css = fs.readFileSync(
    require.resolve('../../src/client/styles/13-equation-layout.css'),
    'utf8'
  );
  assert.match(
    css,
    /\.equation-detail-preview,\s*\.equation-catalog-preview\s*\{[\s\S]*?--atlas-equation-frame-height:\s*184px/
  );
  assert.match(css, /height:\s*var\(--atlas-equation-frame-height\)/);
  assert.match(css, /max-height:\s*var\(--atlas-equation-frame-height\)/);
  assert.ok(
    !css.includes('.equation-vector-ready{'),
    'ready previews must not change frame dimensions'
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*640px\)[\s\S]*?--atlas-equation-frame-height:\s*156px/
  );
  const renderer = fs.readFileSync(
    require.resolve('../../src/client/equations/renderer.js'),
    'utf8'
  );
  assert.ok(!renderer.includes('function previewHeight('));
  assert.ok(renderer.includes('holder.clientHeight - verticalPadding'));
  assert.ok(renderer.includes('geometry.fitEquationGroup('));
  assert.match(renderer, /geometry\.removeVerticalEncroachment\(/);
  assert.match(renderer, /y:\s*Math\.max\(2, Math\.ceil\(scale \* 0\.65\)\)/);
});

test('multipart and single equations scale to fit inside exactly the same frame', () => {
  for (const [width, height] of [
    [290, 174],
    [150, 146],
    [710, 174],
    [52, 100]
  ]) {
    const cases = [
      [{ width: 180, height: 27 }],
      [{ width: 440, height: 35 }],
      [{ width: 175, height: 270 }],
      [
        { width: 110, height: 65 },
        { width: 290, height: 155 }
      ],
      [
        { width: 34, height: 45 },
        { width: 410, height: 50 },
        { width: 300, height: 95 }
      ]
    ];
    for (const sizes of cases) {
      const gap = 10;
      const fitted = fitEquationGroup(sizes, width, height, gap, 5);
      assert.ok(fitted);
      assert.ok(fitted.width <= width + 1e-9, 'group exceeded frame width');
      assert.ok(fitted.height <= height + 1e-9, 'group exceeded frame height');
      for (let i = 0; i < sizes.length; i++) {
        assert.ok(fitted.parts[i].width <= width + 1e-9);
        assert.ok(
          Math.abs(
            fitted.parts[i].width / fitted.parts[i].height - sizes[i].width / sizes[i].height
          ) < 1e-9,
          'distorted an equation'
        );
        assert.ok(
          Math.abs(fitted.parts[i].factor - fitted.factor) < 1e-9,
          'all parts must have consistent font scale'
        );
      }
    }
  }
  assert.equal(
    fitEquationGroup(
      [
        { width: 10, height: 10 },
        { width: 20, height: 20 }
      ],
      100,
      8,
      10
    ),
    null
  );
  assert.equal(fitEquationGroup([], 100, 200), null);
  assert.equal(fitEquationGroup([{ width: 0, height: 20 }], 100, 200), null);
  assert.equal(fitEquationGroup([{ width: 10, height: 10 }], 100, 200, -1), null);
});

test('verified interference masks use the actual paper tone', () => {
  const paints = [];
  const ctx = {
    set fillStyle(color) {
      paints.push(['color', color]);
    },
    fillRect(...rect) {
      paints.push(['rect', ...rect]);
    },
    save() {},
    restore() {}
  };
  assert.equal(
    removeSourceInterference(
      ctx,
      { x: 10, y: 10, width: 40, height: 30 },
      2,
      { exclude: [[14, 14, 18, 18]] },
      '#f8f4ec'
    ),
    1
  );
  assert.deepEqual(paints[0], ['color', '#f8f4ec']);
  assert.equal(
    removeSourceFrames(
      ctx,
      { x: 10, y: 10, width: 40, height: 30 },
      2,
      { frames: [[12, 12, 30, 27]] },
      '#f8f4ec'
    ),
    1
  );
  assert.ok(paints.some(p => p[0] === 'rect'));
});

test('renderer does not erase possible mathematical strokes with heuristic frame cleaning', () => {
  const fs = require('node:fs');
  const renderer = fs.readFileSync(
    require.resolve('../../src/client/equations/renderer.js'),
    'utf8'
  );
  assert.ok(renderer.includes('geometry.fitEquationGroup('));
  assert.ok(renderer.includes('geometry.inkBounds('));
  assert.ok(renderer.includes('geometry.paperColor('));
  assert.ok(!/geometry\.removePeripheralRules\(/.test(renderer));
  assert.ok(!/geometry\.removeDecorativeFrame\(/.test(renderer));
});

test('every one of the 2,000 indexed formula regions can be contained on phones and desktops', () => {
  const entries = require('../../src/client/equations/source-map.json').entries;
  let count = 0;
  for (const [label, entry] of Object.entries(entries)) {
    if (entry.parts) continue;
    const [l, t, r, b] = entry.focus || entry.crop;
    for (const [width, height] of [
      [190, 155],
      [310, 230],
      [620, 390],
      [980, 510]
    ]) {
      const target = fitEquation(r - l, b - t, width, height, 5);
      assert.ok(target, `${label}: missing fit`);
      assert.ok(
        target.width <= width + 0.01 && target.height <= height + 0.01,
        `${label}: overflows preview`
      );
      assert.ok(
        Math.abs(target.width / target.height / ((r - l) / (b - t)) - 1) < 1e-9,
        `${label}: distorted`
      );
    }
    count++;
  }
  assert.equal(count, 2000);
});

test('all 2,004 catalog references fit a fixed frame, including the four multipart entries', () => {
  const entries = require('../../src/client/equations/source-map.json').entries;
  for (const [label, entry] of Object.entries(entries)) {
    const parts = (entry.parts || [label]).map(name => entries[name]);
    const sizes = parts.map(part => {
      const [l, t, r, b] = part.focus || part.crop;
      return { width: r - l, height: b - t };
    });
    for (const [width, height] of [
      [155, 148],
      [300, 174],
      [720, 174]
    ]) {
      const fitted = fitEquationGroup(sizes, width, height, 10, 5);
      assert.ok(fitted, `${label}: no fixed-frame fit`);
      assert.ok(
        fitted.width <= width + 1e-9 && fitted.height <= height + 1e-9,
        `${label}: fixed frame overflow`
      );
      assert.equal(fitted.parts.length, sizes.length);
    }
  }
  assert.equal(Object.keys(entries).length, 2004);
});

test('vertical source guard respects manually reviewed bounds and adjacent equations', () => {
  const entry = { page: 1, crop: [70, 120, 240, 156] };
  const baseline = cropFor(entry, 612, 792);
  const widened = guardVerticalCrop(baseline, entry, [], 792);
  assert.ok(widened.y < baseline.y);
  assert.ok(widened.y + widened.height > baseline.y + baseline.height);
  assert.equal(widened.x, baseline.x);
  assert.equal(widened.width, baseline.width);
  const peers = [
    { page: 1, crop: [80, 102, 230, 118] },
    { page: 1, crop: [80, 158, 230, 177] }
  ];
  const constrained = guardVerticalCrop(baseline, entry, peers, 792);
  assert.ok(constrained.y >= peers[0].crop[3] + 1.09);
  assert.ok(constrained.y + constrained.height <= peers[1].crop[1] - 1.09);
  const exact = {
    page: 1,
    crop: [70, 120, 240, 156],
    focus: [90, 126, 230, 153],
    exactFocus: true
  };
  const exactCrop = cropFor(exact, 612, 792);
  const expandedExact = guardVerticalCrop(exactCrop, exact, [], 792);
  assert.ok(expandedExact.y <= exactCrop.y);
  assert.ok(expandedExact.y + expandedExact.height >= exactCrop.y + exactCrop.height);
});
