# Maintaining table previews

## Ownership

| File | Responsibility |
| --- | --- |
| `src/client/tables/source-map.json` | Reviewed table regions for the exact supplied PDF |
| `src/client/pdf/source-regions.js` | Shared source identity and rectangle validation |
| `src/client/tables/renderer.js` | Rendering queue, page selection and canvas lifecycle |
| `src/client/application/30-discovery.js` | Catalog cards and lazy preview mounting |
| `src/client/application/60-entity-details.js` | Detail mounting and current-page PDF link |
| `src/client/styles/22-table-preview.css` | Preview frames, scrolling and controls |
| `tests/unit/table-previews.test.cjs` | Navigation, fallback and lifecycle regressions |
| `tests/integration/table-previews.mjs` | Real-PDF rendering of every page part |

Change maintained source and regenerate `app/` with the normal build. No new
runtime dependency is required: tables use the same local PDF.js document as
equations and figures.

## Reviewed source coverage

The 6 November 2026 review covers **52 table labels and 81 page parts**, matched
to the supplied PDF by SHA-256 and page count. Every proposed crop was visually
inspected. Eleven bounds were corrected and rechecked to remove neighboring
content while retaining the complete table. The coordinate-only review record
is in [TABLE_REVIEW.json](TABLE_REVIEW.json).

| Multipage table | PDF pages |
| --- | --- |
| 2 | 27-40 |
| 3 | 41-44 |
| 4 | 45-49 |
| 5 | 49-51 |
| 21.4.1 | 1005-1006 |
| 21.8.1 | 1013-1014 |
| 21.8.2 | 1015-1016 |
| C.1 | 1063-1065 |
| C.3 | 1067-1068 |
| C.4 | 1068-1069 |

The remaining 42 tables have one page part each. Separate bounds distinguish
the tables sharing PDF pages 27, 49 and 1068. Printed titles, column headers,
rows, table-specific footnotes and continuation labels belong in a preview.
Ordinary page footnotes, running headers and nearby figures do not.

## Runtime contract

- `AtlasTablePreview.mount(holder, label, page, { onPageChange })` renders the
  first part in a catalog card. A holder with the `table-detail-preview` class
  adds a page selector when the table has multiple parts.
- Both views automatically fit the available width and preserve the source
  aspect ratio. Catalog previews use their natural height; detail previews
  retain a vertically scrollable viewport for tall tables. Selecting another
  page resets the scroll position.
- The `onPageChange` callback reports the selected PDF page immediately, then
  refines its vertical position once the page viewport is available. Positions
  use bottom-origin PDF points, as required by the existing reader. The existing
  Open in PDF button therefore follows the selection even if rendering fails.
- Reviewed regions are used only when the document fingerprint, page count and
  coordinate format match. Other PDFs receive an explicitly labeled original
  source-page preview; their table bounds and continuation pages are not guessed.
- Catalog cards contain no interactive descendants. Clicking the existing card
  opens the table detail, where a dropdown selects continuation pages.
- Two table paints can run concurrently, each capped at six million pixels.
  Superseded page requests and changed sources cannot replace a newer
  preview. Temporary canvases are cleared, and old source tasks are cancelled.
- All pixels come from the user's local PDF. No table cells are transcribed,
  no preview artwork is packaged, and no images or crop preferences are stored.

## Coordinate maintenance

The manifest uses the existing `pdf-points-top-left` convention. Each entry has
`page` and `crop: [left, top, right, bottom]`. Multipage entries also have an
ordered `parts` list. PDF page numbers are one-based and include front matter.

When changing a region, inspect the original page and render the proposed crop.
Check the first/last row, all column headings, superscripts/subscripts, footnotes
and continuation labels. Do not cut off valid mathematical notes just because
they extend below the usual text area. Review every affected part and update
the audit's manifest hash.

Run formatting, the normal build, static checks, unit tests and packaging tests.
With the original local PDF and the optional native canvas dependency installed,
run:

```sh
ATLAS_TEST_PDF=/path/to/original.pdf node tests/integration/table-previews.mjs
```

The Node rendering test checks source coverage and actual PDF painting; it does
not establish browser layout or visual accessibility. Browser execution was
blocked in the environment used for this update, so an interactive browser pass
remains necessary before claiming full UI acceptance.
