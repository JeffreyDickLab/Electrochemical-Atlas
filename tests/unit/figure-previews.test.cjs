'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const {
  findCaption,
  detectCrop,
  textBoxes,
  textRows,
  precedingProseBottom
} = require('../../src/client/figures/geometry.js');

function samplePage() {
  const width = 600,
    height = 780;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    if (i >= 0 && i < data.length) {
      data[i] = data[i + 1] = data[i + 2] = 25;
    }
  };
  for (let y = 155; y <= 345; y++) {
    dark(110, y);
    dark(450, y);
  }
  for (let x = 110; x <= 450; x++) {
    dark(x, 345);
    dark(x, 155);
  }
  for (let x = 110; x <= 450; x++)
    dark(x, Math.round(250 + 60 * Math.sin(((x - 110) * Math.PI * 2) / 340)));
  const boxes = [
    { x: 60, y: 82, width: 480, height: 14, text: 'Paragraph above the actual figure' },
    { x: 80, y: 220, width: 26, height: 12, text: 'C/μF' },
    { x: 110, y: 362, width: 390, height: 13, text: 'Figure 5.7.4 Caption below the graphic' },
    { x: 50, y: 399, width: 480, height: 13, text: 'The next paragraph starts after the caption' }
  ];
  return { width, height, data, boxes };
}

test('figures are identified by their printed caption, not prose references', () => {
  const viewport = {
    scale: 1,
    convertToViewportPoint(x, y) {
      return [x, 780 - y];
    }
  };
  const items = [
    {
      str: 'See Figure 5.7.4 for details',
      width: 135,
      height: 10,
      transform: [1, 0, 0, 10, 60, 720]
    },
    { str: 'Figure', width: 29, height: 10, transform: [1, 0, 0, 10, 110, 418] },
    { str: '5.7.4', width: 22, height: 10, transform: [1, 0, 0, 10, 142, 418] },
    { str: 'Caption', width: 48, height: 10, transform: [1, 0, 0, 10, 169, 418] }
  ];
  const boxes = textBoxes(items, viewport);
  const caption = findCaption(boxes, '5.7.4');
  assert.ok(caption, 'printed figure caption located');
  assert.ok(caption.top > 330 && caption.top < 370);
  assert.equal(findCaption(boxes, '1.2.3'), null);
});

test('figure detection includes the complete chart while excluding caption and prose', () => {
  const scene = samplePage();
  const crop = detectCrop({ ...scene, caption: { top: 362, bottom: 374 } });
  assert.ok(crop);
  assert.ok(crop.x <= 110 && crop.x + crop.width >= 450, JSON.stringify(crop));
  assert.ok(crop.y <= 155 && crop.y + crop.height >= 345, JSON.stringify(crop));
  assert.ok(crop.y > 100, 'paragraph preceding figure is not included');
  assert.ok(crop.y + crop.height <= 358, 'caption is excluded');
});

test('uncertain or blank source graphics are never replaced by a random page crop', () => {
  const scene = samplePage();
  scene.data.fill(255);
  assert.equal(detectCrop({ ...scene, caption: { top: 362, bottom: 374 } }), null);
  assert.equal(detectCrop({ ...scene, caption: null }), null);
});

test('figure previews share the selected PDF without storing artwork', () => {
  const renderer = read('src/client/figures/renderer.js');
  const bootstrap = read('src/client/import/bootstrap.js');
  const details = read('src/client/application/60-entity-details.js');
  const collection = read('src/client/application/30-discovery.js');
  const html = read('src/client/index.html');
  assert.match(renderer, /AtlasEquationPreview\.getDocument\(\)/);
  assert.match(renderer, /clearCanvas\(source\)/);
  assert.doesNotMatch(renderer, /CROP_KEY|localStorage|openEditor|figure-crop-/);
  assert.match(renderer, /AtlasFigureManifest/);
  assert.match(renderer, /ATLAS_SOURCE_SHA256/);
  assert.doesNotMatch(renderer, /sessionStorage|indexedDB|toDataURL|toBlob|download|fetch\(/);
  assert.match(bootstrap, /AtlasFigurePreview\.setSource\(pdfUrl\)/);
  assert.match(collection, /figure-catalog-preview/);
  assert.match(collection, /attachVisibleFigurePreviews\(content\)/);
  assert.match(details, /figure-detail-preview/);
  assert.match(html, /src="figures\/source-map\.js"/);
  assert.match(html, /src="figure-reviewed-crops\.js"/);
  assert.match(html, /src="figure-geometry\.js"/);
  assert.match(html, /src="figure-preview\.js"/);
  assert.equal(read('app/figure-preview.js'), renderer);
  assert.equal(read('app/figure-geometry.js'), read('src/client/figures/geometry.js'));
});

test('Figure 1.1.1-style diagrams exclude the paragraph immediately above', () => {
  const width = 612,
    height = 792;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 20;
  };
  // Two electrochemical-cell panels with upper leads, containers, and bases.
  for (const [l, r] of [
    [64, 248],
    [286, 485]
  ]) {
    for (let y = 349; y <= 524; y++) {
      dark(l, y);
      dark(r, y);
    }
    for (let x = l; x <= r; x++) {
      dark(x, 403);
      dark(x, 524);
    }
    for (let x = l + 10; x <= r - 10; x += 6) dark(x, 405);
  }
  // The paragraph is close enough that the former 17-pixel padding would
  // include it. PDF text rows may consist of multiple font-run fragments.
  const boxes = [
    { x: 56, y: 326, width: 166, height: 16, text: 'connected to the electrodes.' },
    {
      x: 231,
      y: 326,
      width: 270,
      height: 16,
      text: 'When the electrodes are connected, the reaction'
    },
    { x: 95, y: 354, width: 18, height: 11, text: 'Zn' },
    { x: 309, y: 354, width: 18, height: 11, text: 'Ag' },
    { x: 80, y: 538, width: 22, height: 10, text: '(a)' },
    { x: 316, y: 538, width: 22, height: 10, text: '(b)' },
    {
      x: 57,
      y: 564,
      width: 476,
      height: 13,
      text: 'Figure 1.1.1 Two electrochemical cells in different solutions'
    }
  ];
  const crop = detectCrop({ data, width, height, boxes, caption: { top: 564, bottom: 577 } });
  assert.ok(crop, 'two-panel figure detected');
  assert.ok(crop.y > 342, `preceding paragraph was not removed: ${JSON.stringify(crop)}`);
  assert.ok(crop.y <= 349, 'top electrode leads must be retained');
  assert.ok(crop.y + crop.height >= 535, 'panel marks and drawing baseline retained');
  assert.ok(crop.y + crop.height < 564, 'caption must stay outside preview');
  assert.ok(crop.x <= 64 && crop.x + crop.width >= 485, 'both panels retained');
  assert.ok(precedingProseBottom(boxes, width, 349) > 340);
});

test('short plot and circuit labels are not mistaken for paragraph prose', () => {
  const boxes = [
    { x: 155, y: 170, width: 58, height: 13, text: 'Cu2+' },
    { x: 300, y: 170, width: 49, height: 13, text: 'E/V' },
    { x: 180, y: 177, width: 34, height: 13, text: 'Ag/AgCl' }
  ];
  assert.equal(precedingProseBottom(boxes, 612, 193), -1);
  const rows = textRows(boxes);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].text.includes('Cu2+'));
});
