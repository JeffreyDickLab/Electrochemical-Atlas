'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const geometry = require('../../src/client/equations/geometry.js');
const entries = require('../../src/client/equations/source-map.json').entries;

test('per-equation printed-number anchors are bounded and individually indexed', () => {
  let count = 0;
  for (const [label, entry] of Object.entries(entries)) {
    if (!entry.anchorY) continue;
    assert.ok(entry.crop, `${label}: anchor without source region`);
    assert.equal(entry.anchorY.length, 2);
    assert.ok(entry.anchorY.every(Number.isFinite), `${label}: invalid marker`);
    assert.ok(entry.anchorY[0] < entry.anchorY[1]);
    assert.ok((entry.anchorY[0] + entry.anchorY[1]) / 2 >= entry.crop[1] - 15);
    assert.ok((entry.anchorY[0] + entry.anchorY[1]) / 2 <= entry.crop[3] + 15);
    count++;
  }
  assert.ok(count >= 1950, `expected broad individual coverage, got ${count}`);
});

test('closely stacked numbered equations cannot expand into one another', () => {
  const a = { page: 3, crop: [72, 102, 230, 127], anchorY: [110, 120] };
  const b = { page: 3, crop: [72, 125, 230, 152], anchorY: [129, 139] };
  const crop = { x: 72, y: 100, width: 158, height: 56 };
  const scaled = geometry.equationReferenceWindow(a, [a, b], crop, 4);
  const boundary = scaled.maxY / 4 + crop.y;
  assert.ok(boundary > 120 && boundary < 133, `separator ${boundary}`);
  assert.ok(scaled.top >= 0 && scaled.bottom < 120);
  const reverse = geometry.equationReferenceWindow(b, [a, b], crop, 4);
  assert.ok(reverse.minY > scaled.top);
});

test('reference based cropping hides neighboring prose, but retains detached limits', () => {
  const width = 180,
    height = 100;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4)
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 255;
  const stroke = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const at = (y * width + x) * 4;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
      }
  };
  stroke(2, 5, 176, 10); // paragraph above
  stroke(70, 22, 90, 24); // superscript / summation top
  stroke(30, 32, 152, 42); // formula core
  stroke(66, 50, 99, 53); // lower index / denominator
  stroke(2, 78, 176, 83); // paragraph below
  const ctx = {
    getImageData: () => ({ data: pixels }),
    set fillStyle(value) {},
    fillRect(x, y, w, h) {
      for (let py = Math.max(0, y); py < Math.min(height, y + h); py++)
        for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) {
          const at = (py * width + px) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
        }
    }
  };
  const window = geometry.removeVerticalEncroachment(
    ctx,
    width,
    height,
    { top: 32, bottom: 42, minY: 15, maxY: 70, isReference: true },
    '#ffffff'
  );
  assert.ok(window.top <= 22 && window.bottom >= 53);
  assert.ok(window.top > 10 && window.bottom < 78);
  const b = geometry.inkBounds(ctx, width, height, { x: 2, y: 2 });
  assert.ok(b.y <= 22 && b.y + b.height > 53);
});

test('runtime renderer consumes the equation-specific marker coordinates', () => {
  const renderer = fs.readFileSync(
    require.resolve('../../src/client/equations/renderer.js'),
    'utf8'
  );
  assert.match(renderer, /equationReferenceWindow\(entry, peerEntries, crop, scale\)/);
  assert.match(renderer, /referenceAnchor \|\|/);
  assert.ok(renderer.includes('removeVerticalEncroachment'));
});

test('manually isolated exceptions retain whole scientific diagrams', () => {
  assert.ok(entries['17.8.6'].crop[1] < 110);
  assert.ok(entries['21.4.1'].crop[1] < 505);
  assert.ok(entries['1.4.16'].crop[3] > 152);
  assert.ok(entries['10.2.2'].crop[3] < 476);
  assert.ok(entries['6.5.8b'].crop[3] < 548);
  assert.ok(entries['A.2.3'].crop[3] > 656);
});
