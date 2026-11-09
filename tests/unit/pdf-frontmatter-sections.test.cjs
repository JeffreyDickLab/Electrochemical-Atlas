'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFLite } = require('../../src/client/pdf/pdf-core.js');
const { build } = require('../../src/client/pdf/catalog-extractor.js');

// Synthetic PDF operators exercise the real decoder without shipping book text.
function positionedEngine(operators, { missingWidths = false } = {}) {
  const engine = new PDFLite(null);
  engine.pageObjects = [1];
  const widths = Array(95).fill(500).join(' ');
  const objects = new Map([
    [1, '<< /Contents 2 0 R /Resources << /Font << /F3 3 0 R /F4 4 0 R >> >> >>'],
    [3, `<< /BaseFont /Example-Regular /FirstChar 32 /Widths [${widths}] >>`],
    [
      4,
      missingWidths
        ? '<< >>'
        : `<< /BaseFont /ExampleScript-BoldItalic /FirstChar 32 /Widths [${widths}] >>`
    ]
  ]);
  engine.get = id => objects.get(Number(id)) || '';
  engine.stream = async () => Buffer.from(operators);
  return engine;
}

const glyphs = lines => lines.flatMap(line => line.fragments);
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

test('position pass applies glyph widths, TJ spacing, text-line moves, scale and rise', async () => {
  const engine = positionedEngine(`BT /F3 10 Tf 1 0 0 1 100 600 Tm
    [(AB) -1000 (C)] TJ 3 0 Td (D) Tj 0 -12 TD (E) Tj T* (F) Tj
    1 Tc 2 Tw 50 Tz (A A) Tj 2 Ts (Z) Tj ET`);
  const text = await engine.pageText(1);
  const blocks = JSON.stringify(await engine.pageBlocks(1));
  const cache = [...engine.contentCache.entries()];
  const lines = await engine.pageTextPositions(1);
  const actual = glyphs(lines);
  assert.deepEqual(
    actual.map(glyph => glyph.text),
    [...'ABCDEFA AZ']
  );
  [100, 105, 120, 103, 103, 103, 108, 111, 115, 118].forEach((x, i) => close(actual[i].x, x));
  [600, 600, 600, 600, 588, 576, 576, 576, 576, 578].forEach((y, i) => close(actual[i].y, y));
  close(actual[0].width, 5);
  close(actual[6].width, 2.5);
  assert.equal(await engine.pageText(1), text);
  assert.equal(JSON.stringify(await engine.pageBlocks(1)), blocks);
  assert.deepEqual(
    [...engine.contentCache.entries()],
    cache,
    'optional metadata must not alter the text cache'
  );
});

test('large character spacing can put two glyphs in different table columns', async () => {
  const engine = positionedEngine('BT /F3 1 Tf 10 0 0 10 100 600 Tm 20 Tc (XY) Tj ET');
  const [first, second] = glyphs(await engine.pageTextPositions(1));
  close(first.x, 100);
  close(first.width, 5);
  close(second.x, 305);
});

test('font and spacing state survives BT while text matrices reset', async () => {
  const engine = positionedEngine(`BT /F3 10 Tf 2 Tc 1 0 0 1 10 20 Tm (X) Tj ET
    BT 1 0 0 1 100 200 Tm (AA) Tj ET`);
  const [, first, second] = glyphs(await engine.pageTextPositions(1));
  close(first.x, 100);
  close(second.x, 107);
  close(first.size, 10);
});

test('outer graphics transforms fail closed and q/Q restores text state', async () => {
  const engine = positionedEngine(`BT /F3 10 Tf 2 Tc 1 0 0 1 10 20 Tm (A) Tj ET
    q 2 0 0 2 10 20
    cm BT /F3 20 Tf 5 Tc 1 0 0 1 100 200 Tm (B) Tj ET Q
    q 1 0 0 1 30 40 cm 0 0 m 10 10 l S Q
    BT 1 0 0 1 100 200 Tm (CD) Tj ET`);
  const [, transformed, first, second] = glyphs(await engine.pageTextPositions(1));
  assert.equal(transformed.x, null);
  assert.equal(transformed.y, null);
  close(first.x, 100);
  close(second.x, 107);
  close(first.size, 10);
});

test('unavailable font metrics and rotated text never produce guessed positions', async () => {
  const engine = positionedEngine(
    `BT /F4 10 Tf 1 0 0 1 100 600 Tm (X) Tj
    /F3 10 Tf 0 1 -1 0 100 500 Tm (Y) Tj 1 0 0 1 200 400 Tm (Z) Tj ET`,
    { missingWidths: true }
  );
  const [unknown, rotated, valid] = glyphs(await engine.pageTextPositions(1));
  assert.equal(unknown.x, null);
  assert.equal(unknown.y, null);
  assert.equal(rotated.x, null);
  assert.equal(rotated.y, null);
  close(valid.x, 200);
  close(valid.y, 400);
  assert.deepEqual(await engine.pageTextPositions(0), []);
  assert.deepEqual(await engine.pageTextPositions(2), []);
  const noFont = positionedEngine('BT 1 0 0 1 100 200 Tm (X) Tj ET');
  assert.equal(glyphs(await noFont.pageTextPositions(1))[0].x, null);
});

test('source font metadata and short overbars are distinguished from fractions and table rules', async () => {
  const engine = positionedEngine(`BT /F4 10 Tf 1 0 0 1 100 600 Tm (A) Tj ET
    q 1 0 0 1 100 606 cm 0 0 m 5 0 l S Q
    BT /F3 10 Tf 1 0 0 1 200 600 Tm (B) Tj
    1 0 0 1 200 610 Tm (N) Tj ET
    q 1 0 0 1 200 606 cm 0 0 m 5 0 l S Q
    BT 1 0 0 1 300 600 Tm (C) Tj ET
    q 1 0 0 1 295 606 cm 0 0 m 100 0 l S Q`);
  const [barred, denominator, numerator, underRule] = glyphs(await engine.pageTextPositions(1));
  assert.equal(barred.bold, true);
  assert.equal(barred.italic, true);
  assert.equal(barred.scriptFont, true);
  assert.equal(barred.overbar, true);
  assert.equal(denominator.overbar, false);
  assert.equal(numerator.overbar, false);
  assert.equal(underRule.overbar, false);
});

// Coordinates, identifiers and prose here are invented. Every source line has
// glyph metadata so catalog tests exercise row/column association, not a stubbed
// answer for an identifier.
function line(text, segments, y) {
  const fragments = segments.flatMap(([value, x, size = 8, offsetY = 0, style = {}]) => {
    const result = [];
    for (const character of value) {
      const width = character === ' ' ? 2 : 4;
      result.push({ text: character, x, y: y + offsetY, width, size, font: 'F3', ...style });
      x += width;
    }
    return result;
  });
  return { text, fragments };
}
function fixture() {
  const positioned = new Map();
  const symbolRows = [
    line(
      'Symbol Meaning Usual Units Section',
      [
        ['Symbol', 10],
        ['Meaning', 90],
        ['Usual Units', 260],
        ['Section', 350]
      ],
      680
    ),
    line('a', [['a', 10]], 650),
    line(
      '(a) alpha quantity none 4.2.3(a)',
      [
        ['(a) alpha quantity', 90],
        ['none', 260],
        ['4.2.3(a)', 350]
      ],
      650
    ),
    line(
      '(b) another meaning 8.1–8.3',
      [
        ['(b) another meaning', 90],
        ['8.1–8.3', 350]
      ],
      635
    ),
    line(
      '(c) chapter meaning 5, 12',
      [
        ['(c) chapter meaning', 90],
        ['5, 12', 350]
      ],
      620
    ),
    // This identifier is deliberately outside the existing symbol heuristic.
    line('omitted', [['omitted', 10]], 600),
    line(
      'neighbor definition 9.8.7',
      [
        ['neighbor definition', 90],
        ['9.8.7', 350]
      ],
      600
    ),
    line('b', [['b', 10]], 580),
    line('beta quantity', [['beta quantity', 90]], 580),
    line('c', [['c', 10]], 560),
    line(
      '(a) charlie quantity 3.5.3(c,d), Table C.2',
      [
        ['(a) charlie quantity', 90],
        ['3.5.3(c,d), Table C.2', 350]
      ],
      560
    ),
    line(
      '(b) repeated reference 3.5.3(c,d), A.6',
      [
        ['(b) repeated reference', 90],
        ['3.5.3(c,d), A.6', 350]
      ],
      545
    ),
    // A second printed row with the same identifier remains a boundary even
    // though the existing catalog intentionally keeps only its first occurrence.
    line('c', [['c', 10]], 525),
    line(
      'different source row 20.1.3',
      [
        ['different source row', 90],
        ['20.1.3', 350]
      ],
      525
    )
  ];
  positioned.set(28, symbolRows);
  const abbreviationRows = [
    line('Table 4 Standard Abbreviations', [['Table 4 Standard Abbreviations', 10]], 710),
    line(
      'Abbreviation Meaning Section',
      [
        ['Abbreviation', 10],
        ['Meaning', 90],
        ['Section', 350]
      ],
      680
    ),
    line(
      'AV area-to-volume 5, 12',
      [
        ['AV', 10],
        ['area-to-volume', 90],
        ['5, 12', 350]
      ],
      650
    ),
    line(
      'IM impedance method 11, 11.4',
      [
        ['IM', 10],
        ['impedance method', 90],
        ['11, 11.4', 350]
      ],
      635
    ),
    line(
      'CE (a) first meaning 3.1',
      [
        ['CE', 10],
        ['(a) first meaning', 90],
        ['3.1', 350]
      ],
      620
    ),
    line(
      '(b) second meaning 4.5',
      [
        ['(b) second meaning', 90],
        ['4.5', 350]
      ],
      605
    ),
    line(
      'ZZ another meaning 12.3(a)',
      [
        ['ZZ', 10],
        ['another meaning', 90],
        ['12.3(a)', 350]
      ],
      585
    ),
    line('(E)n', [['(E)n', 10]], 565),
    line(
      'omitted notation meaning 9.9',
      [
        ['omitted notation meaning', 90],
        ['9.9', 350]
      ],
      565
    ),
    line(
      'UV ultraviolet',
      [
        ['UV', 10],
        ['ultraviolet', 90]
      ],
      545
    ),
    line(
      'Table 5 Abbreviated Chemical Species',
      [['Table 5 Abbreviated Chemical Species', 10]],
      510
    ),
    line(
      'Abbreviation Meaning Structure',
      [
        ['Abbreviation', 10],
        ['Meaning', 90],
        ['Structure', 350]
      ],
      490
    ),
    line(
      'AB sample chemical Figure 1',
      [
        ['AB', 10],
        ['sample chemical', 90],
        ['Figure 1', 350]
      ],
      470
    )
  ];
  positioned.set(45, abbreviationRows);
  const pages = Array.from({ length: 55 }, () => '');
  pages[26] = 'Table 2 Roman Symbols';
  for (const [page, lines] of positioned) pages[page - 1] = lines.map(row => row.text).join('\n');
  return {
    positioned,
    engine: {
      pageObjects: pages.map((_, index) => index + 1),
      labels: pages.map((_, index) => String(index + 1)),
      outline: [],
      pageText: async page => pages[page - 1],
      pageBlocks: async () => [],
      pageEquationAnchors: async () => [],
      pageTextPositions: async page => positioned.get(page) || []
    }
  };
}

test('symbol sections follow complete printed rows, including omitted and duplicate identifiers', async () => {
  const { catalog } = await build(fixture().engine);
  assert.deepEqual(
    catalog.symbols.map(item => [item.symbol, item.sections]),
    [
      ['a', '4.2.3(a), 8.1–8.3, 5, 12'],
      ['omitted', '9.8.7'],
      ['b', ''],
      ['c', '3.5.3(c,d), Table C.2, A.6'],
      ['c', '20.1.3']
    ]
  );
  const [first, recovered, , firstC, secondC] = catalog.symbols;
  assert.deepEqual(
    first.definitions.map(({ label, meaning, units, sections }) => ({
      label,
      meaning,
      units,
      sections
    })),
    [
      { label: '(a)', meaning: 'alpha quantity', units: 'none', sections: '4.2.3(a)' },
      { label: '(b)', meaning: 'another meaning', units: '', sections: '8.1–8.3' },
      { label: '(c)', meaning: 'chapter meaning', units: '', sections: '5, 12' }
    ]
  );
  assert.equal(first.units, '', 'separate definitions retain their own units');
  assert.deepEqual(first.legacy_keys, ['symbol-a']);
  assert.deepEqual(first.legacy_refs, [{ key: 'symbol-a', page: 28 }]);
  assert.deepEqual(recovered.legacy_keys, [], 'a newly recovered row must not claim an old key');
  assert.notEqual(
    firstC.source_row,
    secondC.source_row,
    'same printed identifiers remain different source rows'
  );
  assert.deepEqual(firstC.legacy_keys, ['symbol-c']);
  assert.deepEqual(
    secondC.legacy_keys,
    [],
    'old same-page deduplication referred only to the first row'
  );
});

test('abbreviation sections preserve chapters and all meanings without crossing into another row or chemicals', async () => {
  const { catalog } = await build(fixture().engine);
  assert.deepEqual(
    catalog.abbreviations.map(item => [item.abbr, item.sections]),
    [
      ['AV', '5, 12'],
      ['IM', '11, 11.4'],
      ['CE', '3.1, 4.5'],
      ['ZZ', '12.3(a)'],
      ['(E)n', '9.9'],
      ['UV', '']
    ]
  );
  assert.equal(catalog.abbreviations[0].meaning, 'area-to-volume');
  assert.equal(catalog.abbreviations[1].meaning, 'impedance method');
  assert.equal(catalog.abbreviations[2].meaning, '(a) first meaning\n(b) second meaning');
  assert.equal(catalog.abbreviations[3].meaning, 'another meaning');
  assert.equal(catalog.abbreviations[4].meaning, 'omitted notation meaning');
  assert.equal(catalog.chemicals.length, 1);
  assert.equal(catalog.chemicals[0].structure_ref, 'Figure 1');
  assert.equal(Object.hasOwn(catalog.chemicals[0], 'sections'), false);
});

function replacePage(data, page, lines) {
  const originalText = data.engine.pageText;
  data.positioned.set(page, lines);
  data.engine.pageText = async number =>
    number === page ? lines.map(row => row.text).join('\n') : originalText(number);
}

test('source-derived styles retain synthetic bold, nested scripts, real units and combining marks', async () => {
  const data = fixture();
  const header = data.positioned.get(28)[0];
  const scriptStyle = { fontName: 'ExampleScript', scriptFont: true, italic: true };
  replacePage(data, 28, [
    header,
    line('Q', [['Q', 10, 8, 0, scriptStyle]], 650),
    line('Q', [['Q', 10.1, 8, 0.05, scriptStyle]], 650),
    line(
      '(a) en(Xs−Y0) sample expression m2 s−1 2.1; 2.2',
      [
        ['(a)', 90],
        ['e', 106],
        ['n(', 110, 6.4, 3],
        ['X', 118, 6.4, 3],
        ['s', 122, 5.1, 0.5],
        ['−', 126, 6.4, 3],
        ['Y', 130, 6.4, 3],
        ['0', 134, 5.1, 5.5],
        [')', 138, 6.4, 3],
        ['sample expression', 148],
        ['m', 260],
        ['2', 264, 6.4, 3],
        ['s', 272],
        ['−1', 276, 6.4, 3],
        ['2.1; 2.2', 350]
      ],
      650
    ),
    line(
      '(b) another complete meaning None',
      [
        ['(b) another complete meaning', 90],
        ['None', 260]
      ],
      630
    ),
    line('̇', [['̇', 12, 8, 2]], 600),
    line('R', [['R', 10]], 600),
    line('rate of a quantity', [['rate of a quantity', 90]], 600)
  ]);
  const { catalog } = await build(data.engine);
  const [script, dotted] = catalog.symbols;
  assert.equal(script.symbol, '𝓠');
  assert.equal(script.symbol_runs[0].bold, true);
  assert.equal(script.symbol_runs[0].scriptFont, true);
  assert.equal(script.symbol_runs[0].italic, true);
  assert.equal(script.definitions[0].sections, '2.1; 2.2');
  assert.equal(script.units, '');
  assert.equal(script.definitions[1].units, 'None');
  assert.deepEqual(script.definitions[0].meaning_runs.find(run => run.text === 's').scripts, [
    'super',
    'sub'
  ]);
  assert.deepEqual(script.definitions[0].meaning_runs.find(run => run.text === '0').scripts, [
    'super',
    'super'
  ]);
  assert.deepEqual(
    script.definitions[0].units_runs.filter(run => run.script === 'super').map(run => run.text),
    ['2', '−1']
  );
  assert.equal(dotted.symbol, 'Ṙ');
  assert.equal(dotted.definitions[0].units, '');
});

test('source-row IDs survive recovered rows and legacy fragments map to their actual printed row', async () => {
  const data = fixture();
  const first = (await build(data.engine)).catalog.symbols[0];
  const sourceLines = data.positioned.get(28);
  replacePage(data, 28, [
    sourceLines[0],
    line('newlyRecovered', [['newlyRecovered', 10]], 665),
    line(
      'another source quantity 3.1',
      [
        ['another source quantity', 90],
        ['3.1', 350]
      ],
      665
    ),
    ...sourceLines.slice(1),
    line('S', [['S', 10]], 500),
    line('scalar expression', [['scalar expression', 90]], 500),
    line('z', [['z', 145]], 485),
    line(
      'arbitrary units 3.1.2',
      [
        ['arbitrary units', 260],
        ['3.1.2', 350]
      ],
      485
    )
  ]);
  const { catalog } = await build(data.engine);
  const retained = catalog.symbols.find(item => item.symbol === 'a');
  assert.equal(retained.source_row, first.source_row);
  assert.equal(retained.y, 650);
  const scalar = catalog.symbols.find(item => item.symbol === 'S');
  assert.deepEqual(scalar.legacy_keys, ['symbol-S', 'symbol-z']);
  assert.deepEqual(scalar.legacy_refs, [
    { key: 'symbol-S', page: 28 },
    { key: 'symbol-z', page: 28 }
  ]);
  assert.equal(
    catalog.symbols.some(item => item.symbol === 'z'),
    false
  );

  // Use the actual reader conversion to lock the existing PDF-point contract.
  const reader = fs.readFileSync(path.join(__dirname, '../../src/client/pdf/reader.js'), 'utf8');
  const context = vm.createContext({
    url: 'blob:source',
    zoom: 100,
    window: {
      ATLAS_PDF_ENGINE: { pageObjects: Array(55).fill(1), get: () => '/CropBox [0 0 600 800]' }
    }
  });
  vm.runInContext(
    reader.slice(reader.indexOf('  function pageHeight('), reader.indexOf('  function navigate(')),
    context
  );
  assert.equal(
    context.sourceUrl(retained.pdf_page, retained.y),
    'blob:source#page=28&zoom=100,0,35'
  );
});

test('missing or inconsistent position metadata keeps entries but never guesses neighboring sections', async () => {
  const differentPrefix = fixture();
  const readPage = differentPrefix.engine.pageText;
  differentPrefix.engine.pageText = async page =>
    (page === 28 ? 'legacy registration mark\n' : '') + (await readPage(page));
  const withPrefix = await build(differentPrefix.engine);
  assert.equal(
    withPrefix.catalog.symbols[0].sections,
    '4.2.3(a), 8.1–8.3, 5, 12',
    'registration marks outside the table do not shift source-row alignment'
  );
  const missing = fixture();
  delete missing.engine.pageTextPositions;
  const withoutPositions = await build(missing.engine);
  assert.equal(withoutPositions.catalog.symbols.length, 3);
  assert.ok(withoutPositions.catalog.symbols.every(item => item.sections === ''));
  const mismatched = fixture();
  mismatched.positioned.get(28)[0].text += ' unmatched';
  const withMismatch = await build(mismatched.engine);
  assert.equal(withMismatch.catalog.symbols.length, 3);
  assert.ok(withMismatch.catalog.symbols.every(item => item.sections === ''));
  const unknownRow = fixture();
  unknownRow.positioned.get(28)[5].fragments[0].x = null;
  const withUnknownBoundary = await build(unknownRow.engine);
  assert.ok(
    withUnknownBoundary.catalog.symbols.every(item => item.sections === ''),
    'an unpositioned omitted row must not disappear as a boundary'
  );
});
