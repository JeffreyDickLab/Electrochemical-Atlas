'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findCaption, findCaptions, detectCrop } = require('../../src/client/figures/geometry.js');

function scene(width = 600, height = 800) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const point = (x, y, r = 18, g = 18, b = 18) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = 4 * (y * width + x);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  };
  const rect = (l, t, r, b, color = [18, 18, 18]) => {
    for (let x = l; x <= r; x++) {
      point(x, t, ...color);
      point(x, b, ...color);
    }
    for (let y = t; y <= b; y++) {
      point(l, y, ...color);
      point(r, y, ...color);
    }
  };
  const fill = (l, t, r, b, color = [18, 18, 18]) => {
    for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) point(x, y, ...color);
  };
  const box = (text, x, y, width = 130, height = 12) => ({ text, x, y, width, height });
  return { width, height, data, point, rect, fill, box };
}
const close = (boundary, x0, y0, x1, y1) => {
  assert.ok(boundary, 'figure crop should exist');
  assert.ok(boundary.x <= x0, `left clipped ${JSON.stringify(boundary)}`);
  assert.ok(boundary.y <= y0, `top clipped ${JSON.stringify(boundary)}`);
  assert.ok(boundary.x + boundary.width >= x1, `right clipped ${JSON.stringify(boundary)}`);
  assert.ok(boundary.y + boundary.height >= y1, `bottom clipped ${JSON.stringify(boundary)}`);
};

test('caption punctuation, split number and appendix ID all match the printed label exactly', () => {
  const boxes = [
    { text: 'See Figure 5.7.4 in the text', x: 50, y: 45, width: 280, height: 13 },
    { text: 'Figure', x: 58, y: 650, width: 45, height: 13 },
    { text: '5.7', x: 108, y: 650, width: 28, height: 13 },
    { text: '.4.', x: 137, y: 650, width: 28, height: 13 },
    { text: 'Response curve', x: 175, y: 650, width: 120, height: 13 },
    { text: 'Fig.', x: 58, y: 755, width: 25, height: 13 },
    { text: 'A.3', x: 87, y: 755, width: 25, height: 13 },
    { text: 'Another figure', x: 117, y: 755, width: 160, height: 13 }
  ];
  assert.equal(findCaption(boxes, '5.7.4')?.top, 650);
  assert.equal(findCaption(boxes, 'A.3')?.top, 755);
  assert.equal(findCaption(boxes, '5.7.40'), null);
  assert.equal(findCaptions(boxes).length, 2);
});

test('tall portrait schematic is not rejected by old 56% page-height limit', () => {
  const s = scene();
  s.rect(95, 79, 496, 638);
  s.rect(130, 100, 450, 180);
  s.rect(130, 260, 450, 360);
  s.rect(130, 465, 450, 605);
  const caption = s.box('Figure 3.1.1 Example', 60, 687, 390);
  const result = detectCrop({ ...s, boxes: [caption], caption: { top: 687, bottom: 699 } });
  close(result, 95, 79, 496, 638);
  assert.ok(result.height > 450);
  assert.ok(result.y + result.height < caption.y);
});

test('separated top/bottom panels join while preserving labels between panels', () => {
  const s = scene();
  s.rect(70, 164, 504, 260);
  s.rect(90, 371, 490, 482);
  const boxes = [
    s.box('(a) Early response', 75, 275, 100),
    s.box('(b) Late response', 75, 499, 118),
    s.box('Figure 6.5.1 Comparison', 60, 563, 365)
  ];
  const result = detectCrop({ ...s, boxes, caption: { top: 563, bottom: 575 } });
  close(result, 70, 164, 504, 511);
  assert.ok(result.y > 110);
  assert.ok(result.y + result.height < 563);
});

test('light colored graphics and embedded-image-style fills remain detectable', () => {
  const s = scene();
  s.fill(68, 180, 530, 402, [232, 220, 209]);
  s.rect(91, 201, 502, 387, [225, 221, 211]);
  const result = detectCrop({
    ...s,
    boxes: [s.box('Figure 2.4.3 Chart', 60, 433, 330)],
    caption: { top: 433, bottom: 446 }
  });
  close(result, 68, 180, 530, 402);
  assert.ok(result.y + result.height < 433);
});

test('figure boundaries exclude artwork from the previous figure on the same page', () => {
  const s = scene();
  s.rect(70, 100, 520, 225);
  s.rect(96, 387, 490, 547);
  const boxes = [
    s.box('Figure 8.2.1 First figure', 60, 247, 350),
    s.box('Figure 8.2.2 Second figure', 60, 568, 390)
  ];
  const result = detectCrop({
    ...s,
    boxes,
    caption: { top: 568, bottom: 580 },
    previousCaptionBottom: 259
  });
  close(result, 96, 387, 490, 547);
  assert.ok(result.y > 259);
});

test('body prose directly before artwork is kept out of the crop', () => {
  const s = scene();
  s.rect(80, 331, 520, 490);
  const boxes = [
    s.box(
      'This illustration compares the voltage response of the electrode at equilibrium.',
      50,
      311,
      510,
      15
    ),
    s.box('Figure 9.1.2 Plot', 55, 520, 450)
  ];
  const result = detectCrop({ ...s, boxes, caption: { top: 520, bottom: 534 } });
  close(result, 80, 331, 520, 490);
  assert.ok(result.y >= 328, JSON.stringify(result));
});

test('figure with title-like caption ABOVE drawing is croppable below it', () => {
  const s = scene();
  s.rect(100, 273, 510, 500);
  const boxes = [s.box('Figure 10.3.1 Schematic', 59, 219, 390)];
  const result = detectCrop({
    ...s,
    boxes,
    caption: { top: 219, bottom: 234 },
    orientation: 'below'
  });
  close(result, 100, 273, 510, 500);
  assert.ok(result.y > 234);
});

test('unrelated prose between a graphic and a caption prevents false pairing', () => {
  const s = scene();
  s.rect(80, 130, 510, 380);
  const boxes = [
    s.box(
      'Experimental values were subsequently compared with the reference electrode.',
      52,
      405,
      510,
      14
    ),
    s.box('Figure 1.4.7 Caption only', 55, 470, 350)
  ];
  const result = detectCrop({ ...s, boxes, caption: { top: 470, bottom: 483 } });
  assert.equal(result, null);
});

test('right-column caption is found even with unrelated left-column text at same y', () => {
  const boxes = [
    { text: 'The electrolyte provides ionic conduction', x: 52, y: 590, width: 235, height: 12 },
    { text: 'Figure', x: 350, y: 590, width: 43, height: 12 },
    { text: '4.2.6', x: 396, y: 590, width: 30, height: 12 },
    { text: 'Counter electrode', x: 430, y: 590, width: 105, height: 12 }
  ];
  assert.equal(findCaption(boxes, '4.2.6')?.x, 350);
});

test('caption prefixes with a larger PDF font still match a smaller, offset number', () => {
  const boxes = [
    { text: 'Figure', x: 60, y: 601, width: 56, height: 22 },
    { text: '12.4.1', x: 120, y: 609, width: 42, height: 10 },
    { text: 'Reaction cell', x: 170, y: 609, width: 120, height: 10 },
    { text: 'Figure13.2.1', x: 60, y: 740, width: 130, height: 16 }
  ];
  assert.equal(findCaption(boxes, '12.4.1')?.top, 601);
  assert.equal(findCaption(boxes, '13.2.1')?.top, 740);
});

test('conservative crop rescues Figure 1.1.5-like vector artwork below prose', () => {
  const { conservativeCrop } = require('../../src/client/figures/geometry.js');
  const s = scene(612, 792);
  s.rect(89, 368, 508, 514, [245, 243, 241]);
  s.rect(100, 388, 503, 510);
  const boxes = [
    s.box('At extreme potentials the background current rises very sharply.', 50, 326, 510, 14),
    s.box('Figure 1.1.5 Current-potential curve', 55, 552, 440, 15)
  ];
  const c = conservativeCrop({ ...s, boxes, caption: { top: 552, bottom: 567 } });
  close(c, 89, 368, 508, 514);
  assert.ok(c.y > 340, 'prose before the graph is excluded');
  assert.ok(c.y + c.height < 552, 'figure caption is excluded');
});
