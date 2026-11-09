'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reviewed = require('../../src/client/figures/reviewed-crops.js');
const regions = require('../../src/client/pdf/source-regions.js');
const manifest = require('../../src/client/figures/source-map.json');
const text = require('../../src/client/core/text.js');

function importedResult() {
  const caption = 'An imported caption describing structures of molecules and ions.';
  const original = {
    label: '1',
    title: 'Figure 1',
    caption,
    description: caption,
    text: caption,
    pdf_page: 52,
    printed_page: 'l',
    y: 0,
    source_kind: 'Original figure caption from selected PDF'
  };
  const other = { ...original, label: '1.1.1', title: 'Figure 1.1.1', pdf_page: 58 };
  return {
    catalog: {
      meta: { pdf_pages: 1107, counts: { figures: 2, tables: 0 } },
      figures: [original, other],
      tables: [],
      equations: [],
      problems: [],
      sections: [],
      references: [],
      abbreviations: [],
      chemicals: [],
      symbols: [],
      index: [],
      entity_aliases: { 'old-equation': 'equation-2.1.1' }
    },
    pages: Array.from({ length: 1107 }, (_, i) => ({
      pdf_page: i + 1,
      printed_page: i === 51 ? 'l' : i === 52 ? 'li' : String(i + 1)
    }))
  };
}

test('figure validation delegates unchanged geometry rules to the shared source-region module', () => {
  for (const name of ['normalizeLabel', 'validRectangle', 'matchesDocument', 'fitsPage'])
    assert.equal(reviewed[name], regions[name]);
  assert.ok(Object.isFrozen(regions));
});

test('the imported multipage figure becomes two ordinary entries with correct pages and shared text', () => {
  const result = importedResult();
  const [original, other] = result.catalog.figures;
  const originalSnapshot = structuredClone(original);
  const mapSnapshot = JSON.stringify(manifest);
  assert.equal(reviewed.reconcile(result, manifest, manifest.pdf_sha256), true);
  const [first, second, retained] = result.catalog.figures;
  assert.deepEqual(
    [first, second].map(item => [item.label, item.title, item.pdf_page, item.printed_page]),
    [
      ['1 (Part 1)', 'Figure 1 (Part 1)', 52, 'l'],
      ['1 (Part 2)', 'Figure 1 (Part 2)', 53, 'li']
    ]
  );
  for (const [index, part] of [first, second].entries()) {
    assert.equal(part.source_label, '1');
    assert.equal(part.source_part, index + 1);
    for (const key of ['caption', 'description', 'text', 'source_kind', 'y'])
      assert.equal(part[key], original[key], `Preserve imported ${key}`);
    const reviewedPart = reviewed.findParts(manifest, part.label);
    assert.equal(reviewedPart.length, 1);
    assert.equal(part.sourceTop, reviewedPart[0].crop[1]);
  }
  const reviewedOther = manifest.entries[other.label];
  assert.deepEqual(retained, {
    ...other,
    sourcePage: reviewedOther.page,
    sourceTop: reviewedOther.crop[1]
  });
  assert.equal(retained.pdf_page, other.pdf_page, 'the indexed page and identity are preserved');
  assert.equal(result.catalog.meta.counts.figures, 3);
  assert.equal(result.catalog.meta.counts.tables, 0);
  assert.deepEqual(result.catalog.entity_aliases, {
    'old-equation': 'equation-2.1.1',
    'figure-1': 'figure-1 (Part 1)'
  });
  assert.deepEqual(original, originalSnapshot, 'do not mutate the original source entry');
  assert.equal(JSON.stringify(manifest), mapSnapshot, 'reviewed coordinates are unchanged');

  const figures = result.catalog.figures;
  const aliases = result.catalog.entity_aliases;
  assert.equal(reviewed.reconcile(result, manifest, manifest.pdf_sha256), true);
  assert.equal(result.catalog.figures, figures, 'reconciliation must not create parts of parts');
  assert.equal(result.catalog.entity_aliases, aliases);
});

test('a reviewed single figure on its indexed page needs only the crop offset', () => {
  const result = importedResult();
  const figure = result.catalog.figures[1];
  const entry = manifest.entries[figure.label];
  figure.pdf_page = entry.page;
  assert.equal(reviewed.reconcile(result, manifest, manifest.pdf_sha256), true);
  assert.deepEqual(result.catalog.figures[2], { ...figure, sourceTop: entry.crop[1] });
  const figures = result.catalog.figures;
  assert.equal(reviewed.reconcile(result, manifest, manifest.pdf_sha256), true);
  assert.equal(result.catalog.figures, figures);
});

test('figure splitting requires the reviewed PDF and never manufactures missing captions', () => {
  for (const [fingerprint, pages] of [
    ['a'.repeat(64), 1107],
    [manifest.pdf_sha256, 1106],
    ['', 1107]
  ]) {
    const result = importedResult();
    result.catalog.meta.pdf_pages = pages;
    const before = structuredClone(result);
    assert.equal(reviewed.reconcile(result, manifest, fingerprint), false);
    assert.deepEqual(result, before);
  }
  const absent = importedResult();
  absent.catalog.figures = [absent.catalog.figures[1]];
  absent.catalog.meta.counts.figures = 1;
  const [original] = absent.catalog.figures;
  const entry = manifest.entries[original.label];
  assert.equal(reviewed.reconcile(absent, manifest, manifest.pdf_sha256), true);
  assert.deepEqual(absent.catalog.figures, [
    { ...original, sourcePage: entry.page, sourceTop: entry.crop[1] }
  ]);
  assert.equal(absent.catalog.meta.counts.figures, 1);
  assert.equal(absent.catalog.entity_aliases['figure-1'], undefined);
});

function applicationHelpers(result, user) {
  const context = vm.createContext({
    window: { ATLAS_SOURCE_SHA256: manifest.pdf_sha256 },
    C: result.catalog,
    PAGES: result.pages,
    pageByNumber: new Map(result.pages.map(page => [page.pdf_page, page])),
    user,
    state: {},
    esc: text.escapeHtml,
    norm: text.normalize,
    shorten: text.shorten
  });
  for (const file of [
    '10-state-and-layout.js',
    '30-discovery.js',
    '50-study-tools.js',
    '60-entity-details.js',
    '70-search.js'
  ]) {
    const filename = path.resolve(__dirname, '../../src/client/application', file);
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}

test('existing Figure 1 bookmarks and notes resolve to Part 1, while Part 2 saves independently', () => {
  const result = importedResult();
  reviewed.reconcile(result, manifest, manifest.pdf_sha256);
  const [first, second] = result.catalog.figures;
  const user = {
    bookmarks: { entities: ['figure-1'], pages: [] },
    notes: { 'figure-1': 'My existing Figure 1 note' }
  };
  const app = applicationHelpers(result, user);
  const restored = app.resolveEntityBookmark('figure-1');
  assert.equal(restored.item, first);
  assert.equal(restored.title, 'Figure 1 (Part 1)');
  assert.equal(restored.page, 52);
  assert.equal(restored.key, 'figure-1', 'the saved key remains usable for removing the bookmark');
  assert.equal(app.isEntityBookmarked('figure', first), true);
  assert.equal(app.noteKey('figure', first), 'figure-1');
  assert.equal(app.resolveTitleFromKey('figure-1'), 'Figure 1 (Part 1)');
  assert.equal(app.isEntityBookmarked('figure', second), false);
  assert.equal(app.noteKey('figure', second), app.entityKey('figure', second));

  user.bookmarks.entities.push(app.entityKey('figure', second));
  user.notes[app.noteKey('figure', second)] = 'My separate Part 2 note';
  assert.equal(app.isEntityBookmarked('figure', second), true);
  assert.equal(app.resolveEntityBookmark('figure-1 (Part 2)').item, second);
  assert.equal(user.notes[app.noteKey('figure', first)], 'My existing Figure 1 note');
});

test('both parts have distinct catalog cards, search results, and previous/next destinations', () => {
  const result = importedResult();
  reviewed.reconcile(result, manifest, manifest.pdf_sha256);
  const [first, second, following] = result.catalog.figures;
  const app = applicationHelpers(result, { bookmarks: { entities: [] }, notes: {} });
  for (const [index, part] of [first, second].entries()) {
    const card = app.collectionCard('figures', part, index);
    assert.ok(card.includes(part.title));
    assert.ok(card.includes(`data-figure-label="${part.label}"`));
    assert.ok(card.includes(`data-figure-page="${part.pdf_page}"`));
    assert.equal(app.entityTitle('figure', part), part.title);
    assert.equal(app.entityPage('figure', part), part.pdf_page);
    const found = app.searchAll(part.title, 'figures');
    assert.equal(found.length, 1);
    assert.equal(found[0].entity, part);
    assert.equal(found[0].page, part.pdf_page);
  }
  assert.equal(app.neighborInfo('figure', first).next, second);
  assert.equal(app.neighborInfo('figure', second).prev, first);
  assert.equal(app.neighborInfo('figure', second).next, following);
});
