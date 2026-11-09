'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const text = require('../../src/client/core/text.js');
const read = name => fs.readFileSync(path.join(__dirname, '../../src/client', name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const fingerprint = source => createHash('sha256').update(source).digest('hex');

function catalogFixture() {
  return {
    meta: { pdf_pages: 200 },
    sections: [{ key: 'section-1.1', id: '1.1', title: 'Section 1.1', pdf_page: 20 }],
    figures: [
      { label: '1 (Part 1)', title: 'Figure 1 (Part 1)', pdf_page: 52 },
      { label: '1 (Part 2)', title: 'Figure 1 (Part 2)', pdf_page: 53 }
    ],
    tables: [{ label: '1.1', title: 'Table 1.1', pdf_page: 23 }],
    equations: [{ label: '1.1.1', title: 'Equation 1.1.1', pdf_page: 22 }],
    problems: [{ label: '1.1', title: 'Problem 1.1', pdf_page: 25 }],
    references: [
      { chapter: 1, number: 1, pdf_page: 26 },
      { chapter: 2, number: 1, pdf_page: 36 }
    ],
    symbols: [
      {
        symbol: 'E',
        meaning: 'Potential',
        pdf_page: 28,
        source_row: 'table-2-p28-y500000',
        legacy_keys: ['symbol-E'],
        legacy_refs: [{ key: 'symbol-E', page: 28, occurrence: 0 }]
      },
      {
        symbol: 'E',
        meaning: 'Energy',
        pdf_page: 28,
        source_row: 'table-2-p28-y480000',
        legacy_keys: ['symbol-E'],
        legacy_refs: [{ key: 'symbol-E', page: 28, occurrence: 1 }]
      },
      {
        symbol: 'E',
        meaning: 'Field',
        pdf_page: 29,
        source_row: 'table-2-p29-y500000',
        legacy_keys: ['symbol-E'],
        legacy_refs: [{ key: 'symbol-E', page: 29 }]
      },
      {
        symbol: 'k⁰',
        meaning: 'Rate constant',
        pdf_page: 30,
        source_row: 'table-2-p30-y500000',
        legacy_keys: ['symbol-k', 'symbol-o']
      },
      {
        symbol: 'new',
        meaning: 'Recovered source row',
        pdf_page: 30,
        source_row: 'table-2-p30-y400000',
        legacy_keys: []
      }
    ],
    abbreviations: [
      {
        abbr: 'EIS',
        meaning: 'Impedance spectroscopy',
        pdf_page: 45,
        source_row: 'table-4-p45-y500000',
        legacy_keys: ['abbreviation-EIS']
      }
    ],
    chemicals: [{ abbr: 'Fc', meaning: 'Ferrocene', pdf_page: 50 }],
    index: [
      { term: 'Diffusion', parent: 'Transport', pages: ['10'], pdf_page: 190 },
      { term: 'Diffusion', parent: 'Measurements', pages: ['20'], pdf_page: 190 },
      { term: 'Diffusion', parent: 'Transport', pages: ['30'], pdf_page: 191 }
    ],
    entity_aliases: { 'figure-1': 'figure-1 (Part 1)' }
  };
}

function harness({
  catalog = catalogFixture(),
  source = 'source-a',
  values = new Map(),
  user
} = {}) {
  const notices = [],
    alerts = [];
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const loaded = key => JSON.parse(values.get(key) || 'null');
  user ||= {
    bookmarks: loaded('ea_bookmarks') || { pages: [], entities: [] },
    notes: loaded('ea_notes') || {},
    read: loaded('ea_read') || {},
    theme: 'light',
    guide: false
  };
  const sourceId = source ? fingerprint(source) : '';
  const pageButton = {};
  const context = vm.createContext({
    C: catalog,
    user,
    storage,
    state: { readerPage: 20 },
    window: {
      ATLAS_SOURCE_SHA256: sourceId,
      ATLAS_SOURCE_REPORT: source
        ? { signature: sourceId.slice(0, 20), pageCount: 200, fileName: 'test.pdf' }
        : null,
      AtlasLayout: { notify: message => notices.push(message), exportState: () => ({}) }
    },
    document: { documentElement: { dataset: {} }, body: { classList: { toggle() {} } } },
    $: selector => {
      assert.equal(selector, '#bookmarkPage');
      return pageButton;
    },
    esc: text.escapeHtml,
    shorten: text.shorten,
    norm: text.normalize,
    alert: message => alerts.push(message),
    FileReader: class {
      readAsText(file) {
        this.result = file.contents;
        this.onload();
      }
    },
    Blob,
    setTimeout: callback => callback(),
    console
  });
  vm.runInContext(
    read('application/10-state-and-layout.js') + '\n' + read('application/50-study-tools.js'),
    context
  );
  return {
    app: context,
    catalog,
    user,
    storage,
    values,
    sourceId,
    notices,
    alerts,
    key: (type, item) => context.entityKey(type, item)
  };
}

test('source-row keys distinguish every symbol, repeated concept, and reference', () => {
  const h = harness();
  for (const [type, list] of [
    ['symbol', h.catalog.symbols],
    ['concept', h.catalog.index],
    ['reference', h.catalog.references]
  ]) {
    const keys = list.map(item => h.key(type, item));
    assert.equal(new Set(keys).size, list.length);
    keys.forEach((key, index) => assert.equal(h.app.resolveEntityBookmark(key).item, list[index]));
  }
  const reordered = plain(h.catalog);
  reordered.symbols.reverse();
  reordered.symbols[4].symbol = 'corrected E';
  const reload = harness({ catalog: reordered });
  const original = h.catalog.symbols[0];
  const updated = reordered.symbols.find(item => item.source_row === original.source_row);
  assert.equal(reload.key('symbol', updated), h.key('symbol', original));
  assert.equal(reload.app.resolveEntityBookmark(h.key('symbol', original)).item, updated);
  assert.doesNotMatch(h.key('symbol', original), /Potential/);
});

test('the same label in another PDF never resolves to the current source', () => {
  const first = harness();
  const other = harness({ source: 'source-b' });
  const key = first.key('figure', first.catalog.figures[0]);
  assert.notEqual(key, other.key('figure', other.catalog.figures[0]));
  assert.equal(other.app.resolveEntityBookmark(key), null);
});

test('legacy resolution uses explicit row aliases and qualified old occurrences without guessing', () => {
  const h = harness();
  assert.equal(h.app.resolveEntityBookmark('symbol-E'), null);
  assert.equal(h.app.resolveEntityBookmark('concept-Diffusion'), null);
  assert.equal(h.app.resolveEntityBookmark('concept-Diffusion', { parent: 'Transport' }), null);
  assert.equal(
    h.app.resolveEntityBookmark('symbol-E', { page: 28, occurrence: 0 }).item,
    h.catalog.symbols[0]
  );
  assert.equal(
    h.app.resolveEntityBookmark('symbol-E', { page: 28, occurrence: 1 }).item,
    h.catalog.symbols[1]
  );
  assert.equal(h.app.resolveEntityBookmark('symbol-E', { page: 29 }).item, h.catalog.symbols[2]);
  assert.equal(h.app.resolveEntityBookmark('symbol-E', { page: 28, occurrence: 99 }), null);
  assert.equal(
    h.app.resolveEntityBookmark('symbol-new'),
    null,
    'newly recovered labels cannot claim old data'
  );
  assert.equal(h.app.resolveEntityBookmark('figure-1').item, h.catalog.figures[0]);
  assert.equal(h.app.resolveEntityBookmark('abbreviation-EIS').item, h.catalog.abbreviations[0]);
  h.catalog.entity_aliases.cycleA = 'cycleB';
  h.catalog.entity_aliases.cycleB = 'cycleA';
  assert.equal(h.app.resolveEntityBookmark('cycleA'), null);
});

test('migration preserves ambiguous data and conflicting alias notes without attributing either to a wrong row', () => {
  const h = harness();
  const target = h.key('symbol', h.catalog.symbols[3]);
  const old = {
    bookmarks: {
      pages: [20],
      entities: ['figure-1', 'symbol-E', 'concept-Diffusion', 'problem-missing']
    },
    notes: {
      'symbol-E': 'Ambiguous E note',
      'concept-Diffusion': 'Ambiguous term note',
      'symbol-k': 'Older fragment note',
      [target]: 'Current canonical note',
      'symbol-o': 'Second fragment note'
    },
    read: {}
  };
  const before = plain(old);
  const migrated = h.app.migrateSavedEntryData(old, h.app.entityIdentities(), h.sourceId);
  assert.deepEqual(old, before, 'migration does not mutate its input backup');
  assert.deepEqual(Array.from(migrated.bookmarks.entities), [
    h.key('figure', h.catalog.figures[0])
  ]);
  assert.equal(migrated.notes[target], 'Current canonical note');
  assert.deepEqual(
    Array.from(
      migrated.unassigned.filter(item => item.kind === 'note'),
      item => item.value
    ).sort(),
    [
      'Ambiguous E note',
      'Ambiguous term note',
      'Older fragment note',
      'Second fragment note'
    ].sort()
  );
  assert.equal(migrated.unassigned.filter(item => item.reason === 'ambiguous').length, 4);
  assert.equal(migrated.unassigned.filter(item => item.reason === 'conflict').length, 2);
  Object.assign(h.user, migrated);
  for (const item of h.catalog.symbols.slice(0, 3)) {
    assert.equal(h.app.isEntityBookmarked('symbol', item), false);
    assert.equal(h.user.notes[h.app.noteKey('symbol', item)], undefined);
  }
  assert.match(h.app.unassignedSavedItemsHTML(), /Ambiguous E note/);
  assert.match(h.app.unassignedSavedItemsHTML(), /data-unassigned-target=/);
});

test('startup migrates once per PDF, preserves raw v5 storage, and restores the correct source envelope', () => {
  const values = new Map([
    ['ea_bookmarks', JSON.stringify({ pages: [52], entities: ['figure-1', 'symbol-E'] })],
    [
      'ea_notes',
      JSON.stringify({
        'figure-1': 'Original Figure 1 note',
        'symbol-E': 'Keep this ambiguous note'
      })
    ],
    ['ea_read', JSON.stringify({ 'section-1.1': true })],
    ['ea_theme', 'dark']
  ]);
  const originals = new Map(values);
  const first = harness({ values });
  first.app.initializeSavedEntries();
  assert.equal(
    first.user.notes[first.key('figure', first.catalog.figures[0])],
    'Original Figure 1 note'
  );
  assert.equal(first.user.unassigned.length, 2);
  assert.equal(values.get('ea_study_v2_legacy_source'), first.sourceId);
  for (const [key, value] of originals) assert.equal(values.get(key), value);
  const savedFirst = values.get(`ea_study_v2:${first.sourceId}`);
  const second = harness({ values, source: 'source-b' });
  second.app.initializeSavedEntries();
  assert.deepEqual(plain(second.user.bookmarks), { pages: [], entities: [] });
  assert.deepEqual(plain(second.user.notes), {});
  assert.deepEqual(plain(second.user.read), {});
  assert.equal(values.get(`ea_study_v2:${first.sourceId}`), savedFirst);
  const reloaded = harness({ values });
  reloaded.app.initializeSavedEntries();
  assert.equal(
    reloaded.user.notes[reloaded.key('figure', reloaded.catalog.figures[0])],
    'Original Figure 1 note'
  );
  assert.equal(reloaded.user.unassigned.length, 2);
  assert.equal(values.get('ea_theme'), 'dark');
});

test('a source without a fingerprint keeps session data without claiming or overwriting older saved data', () => {
  const values = new Map([['ea_notes', JSON.stringify({ 'figure-1': 'Legacy note' })]]);
  const h = harness({ values, source: '' });
  h.app.initializeSavedEntries();
  assert.equal(h.app.window.ATLAS_TEMP_STORAGE, true);
  assert.equal(values.size, 1);
  assert.equal(values.get('ea_notes'), JSON.stringify({ 'figure-1': 'Legacy note' }));
});

test('backup merges retain current notes, preserve differing versions, and are repeatable', () => {
  const h = harness();
  const key = h.key('figure', h.catalog.figures[0]);
  const current = {
    bookmarks: { pages: [20], entities: [key] },
    notes: { [key]: 'Current note' },
    read: {}
  };
  const backup = {
    bookmarks: { pages: [21], entities: ['figure-1'] },
    notes: { 'figure-1': 'Backup note' },
    read: {}
  };
  const merged = h.app.mergeSavedEntryData(current, backup, h.app.entityIdentities(), h.sourceId);
  assert.deepEqual(Array.from(merged.bookmarks.pages), [20, 21]);
  assert.equal(merged.bookmarks.entities.length, 1);
  assert.equal(merged.notes[key], 'Current note');
  assert.equal(merged.unassigned[0].value, 'Backup note');
  assert.equal(merged.unassigned[0].reason, 'conflict');
  const repeated = h.app.mergeSavedEntryData(merged, backup, h.app.entityIdentities(), h.sourceId);
  assert.equal(repeated.unassigned.length, 1);
});

test('explicit reassignment attaches only the chosen row and retains an existing note', () => {
  const h = harness();
  const migrated = h.app.migrateSavedEntryData(
    { bookmarks: { entities: ['symbol-E'], pages: [] }, notes: { 'symbol-E': 'Legacy note' } },
    h.app.entityIdentities(),
    h.sourceId
  );
  Object.assign(h.user, migrated);
  const chosen = h.key('symbol', h.catalog.symbols[1]);
  h.user.notes[chosen] = 'Current note';
  assert.equal(h.app.assignSavedEntry(0, ''), false);
  assert.equal(h.app.assignSavedEntry(0, chosen), true);
  assert.equal(h.app.isEntityBookmarked('symbol', h.catalog.symbols[1]), true);
  assert.equal(h.app.isEntityBookmarked('symbol', h.catalog.symbols[0]), false);
  assert.equal(h.app.assignSavedEntry(0, chosen), true);
  assert.equal(h.user.notes[chosen], 'Current note\n\nLegacy note');
  assert.equal(h.user.unassigned.length, 0);
});

test('old backup import migrates aliases; identified foreign backups leave current data unchanged', () => {
  const h = harness();
  h.app.renderNotes = () => {};
  h.app.importUserData({
    size: 500,
    contents: JSON.stringify({
      version: 3,
      source: { fingerprint: h.sourceId.slice(0, 20), pageCount: 200 },
      bookmarks: { entities: ['figure-1'], pages: [52] },
      notes: { 'figure-1': 'Backup note' }
    })
  });
  assert.equal(h.alerts.length, 0);
  assert.equal(h.user.notes[h.key('figure', h.catalog.figures[0])], 'Backup note');
  const before = plain(h.user);
  h.app.importUserData({
    size: 500,
    contents: JSON.stringify({
      version: 4,
      source: { sourceId: fingerprint('other-source'), pageCount: 200 },
      notes: { 'figure-1': 'Wrong source note' }
    })
  });
  assert.deepEqual(plain(h.user), before);
  assert.match(h.alerts[0], /different PDF/);
});

test('attaching two long note versions preserves their complete text after a saved-data reload', () => {
  const h = harness();
  const key = h.key('figure', h.catalog.figures[0]);
  const first = 'a'.repeat(60000),
    second = 'b'.repeat(60000);
  h.user.notes[key] = first;
  h.user.unassigned = [
    { kind: 'note', key, value: second, reason: 'conflict', sourceId: h.sourceId }
  ];
  assert.equal(h.app.assignSavedEntry(0, key), true);
  const complete = first + '\n\n' + second;
  assert.equal(h.user.notes[key], complete);
  const reloaded = harness({ values: h.values });
  reloaded.app.initializeSavedEntries();
  assert.equal(reloaded.user.notes[key], complete);
  assert.equal(reloaded.user.unassigned.length, 0);
});

test('backup export includes source identity and every unassigned note and bookmark', async () => {
  const h = harness();
  h.user.unassigned = [
    {
      kind: 'note',
      key: 'symbol-E',
      value: 'Preserved note',
      reason: 'ambiguous',
      sourceId: h.sourceId
    },
    { kind: 'bookmark', key: 'symbol-E', reason: 'ambiguous', sourceId: h.sourceId }
  ];
  let blob;
  h.app.URL = {
    createObjectURL(value) {
      blob = value;
      return 'blob:backup';
    },
    revokeObjectURL() {}
  };
  h.app.document.createElement = () => ({ click() {} });
  h.app.exportUserData();
  const backup = JSON.parse(await blob.text());
  assert.equal(backup.version, 4);
  assert.equal(backup.source.sourceId, h.sourceId);
  assert.deepEqual(backup.unassigned, h.user.unassigned);
});
