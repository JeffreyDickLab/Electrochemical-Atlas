# Notation extraction and presentation

The notation catalog is derived from the selected local PDF at import time.
The application package contains no extracted textbook definitions, notation
tables or page images. The existing PDF and application modules own each step.

## Source model

`pdf/pdf-core.js` supplies optional glyph positions, explicit font information
and relevant source strokes for the front-matter tables. Normal `pageText` and
`pageBlocks` behavior remains independent of this pass.

`pdf/catalog-extractor.js` identifies the table columns and printed row
boundaries. It collects complete identifiers and Meaning, Usual Units and
Section cells, including continuation lines and lettered meanings. A blank
unit cell stays empty; a printed value such as `None` remains source text.

| Field | Purpose |
| --- | --- |
| `symbol` or `abbr` | Searchable identifier text |
| `source_row` | Stable table, PDF page and source-baseline identity |
| `source_table`, `pdf_page`, `y` | Source table and bottom-origin PDF location |
| `definitions` | Ordered printed meanings, each with its label, meaning, units and sections |
| `symbol_runs` / `abbr_runs` | Explicit source typography for the identifier |
| `meaning_runs`, `units_runs` | Explicit typography within a definition |
| `meaning`, `units`, `sections` | Plain-text aggregate fields for compatible consumers |
| `legacy_keys`, `legacy_refs` | Source-derived associations with the older importer |

An aggregate units value is present for a single meaning. Multiple meanings
keep their units inside `definitions`, where their association is unambiguous.
Both local notation filtering and global search index every definition's
meaning, units and sections.

## Source typography

Each rich run contains text and a small whitelist of source-derived attributes:
`bold`, `italic`, `scriptFont`, `overbar`, and `script` (`sub` or `super`). An
optional `scripts` path represents nested scripts. Font and baseline evidence
determines these attributes; source strokes identify overbars. The extractor
does not reconstruct mathematical expressions from guessed chemical meaning.

`science/notation.js` escapes every text run and emits only controlled spans,
subscripts and superscripts. Missing run metadata uses the existing scientific
text formatter. `application/40-catalog.js` keeps each preview as one native
button, with ordered definition groups inside it. `60-entity-details.js` uses
the same groups and makes exact indexed section references navigable. Ranges,
table citations and unindexed suffixes retain their source text.

## Saved-entry compatibility

Corrected identifiers and additional rows must not move existing notes to a
different quantity. The source row is therefore the primary identity for
notation entries. The old importer is used only to derive migration associations
from its source lines; its incomplete identifiers do not define the new catalog.

The shared application identity registry resolves one candidate or reports an
ambiguous/missing match. Saved-data migration preserves ambiguous entries and
conflicting note versions in Unassigned saved items. Qualified older recent
records can use their page and occurrence to resolve the corresponding source
row. Newly recovered rows do not claim an older label's saved data.

## Source coverage

The 6 November 2026 audit covers PDF pages 27–49 of the supplied edition:

| Source table | Printed rows | Meaning groups |
| --- | ---: | ---: |
| Table 2, Roman symbols | 310 | 372 |
| Table 3, Greek symbols | 77 | 108 |
| Table 4, Standard abbreviations | 157 | 161 |
| Total | 544 | 641 |

This includes 387 symbol entries and 157 standard abbreviations. The separate
82 chemical-abbreviation records retain their existing source structure
references. The source audit checks identifiers, all meaning and unit cells,
per-meaning sections, scripts, font distinctions, bars, row order and aliases.
Audit text and glyph evidence stay outside the distributable project.

## Maintainer checks

Use synthetic fixtures in `tests/unit/pdf-frontmatter-sections.test.cjs` and the
related notation, identity and navigation tests for regressions. Re-import the
actual locally held PDF for any change to row detection, script grouping or
legacy associations. Compare complete source cells and all non-notation
catalogs; do not use matching row counts as the only correctness check.

The browser fixtures cover rich card wrapping and native interactions, but
must be executed in an environment that permits browser testing before claiming
interactive visual acceptance. Current run details belong in
[Release validation](RELEASE_VALIDATION.md).
