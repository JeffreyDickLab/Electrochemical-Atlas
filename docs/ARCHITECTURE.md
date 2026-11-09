# Architecture

## Design

Electrochemical Atlas has a static browser client and a small local Go HTTP launcher. The launcher binds to `127.0.0.1`, serves `app/`, selects a local PDF and tracks browser-tab sessions so the server can shut down when the application closes. PDF bytes are read from their original location and are never stored in the package or transmitted to an external Atlas service.

| Component | Maintained source | Responsibilities |
|---|---|---|
| Application and navigation | `src/client/application/`, `navigation/`, `layout/` | Search, study state, bookmarks, views, responsive panes |
| PDF import and reading | `src/client/pdf/` | Local parsing, text catalog, viewer, path integration |
| Figure renderer | `src/client/figures/` | Reviewed coordinates, edition checks, bounded local rendering, generic PDF detection |
| Table renderer | `src/client/tables/` | Reviewed page regions, automatic width fitting and page selection |
| Equation renderer | `src/client/equations/` | Coordinates, edition fingerprint, local canvas rendering and crop cleanup |
| Calculators | `src/client/calculators/`, `science/` | Independent models, notation and interfaces |
| Launcher | `src/launcher/` | Local HTTP, platform dialogs, PDF selection, tab lifecycle, renderer bootstrap |
| Build and release | `tools/`, `.github/workflows/` | Generate `app/`, verify source consistency, package portable releases |

`tools/build.mjs` assembles the existing ordered application modules into `app/app.js`, merges CSS in numbered source order, copies the standalone modules, and generates the figure, table and equation manifest scripts from their JSON sources. The current application modules intentionally share one closure; this arrangement is not equivalent to independent ES modules. Avoid a speculative framework migration without integration tests.

`npm run package:source` creates a GitHub-repository archive **without** prebuilt native binaries or PDF.js. `npm run package:portable` includes the native launchers but requires a one-time internet connection if PDF.js is not yet cached.

`npm run test:browser` runs the synthetic UI acceptance suite without the
reference book. Optional screenshots go to the ignored test artifacts folder.

`npm run build:source` regenerates the web client **without** fetching or bundling PDF.js. `npm run build` requires `pdfjs-dist` from npm and bundles the display module, worker, and upstream license for offline operation. Generated files must not be manually edited.

## Formatting and source ownership

`prettier.config.mjs` and the pinned dependency in `package-lock.json` define
formatting for maintained JavaScript, CSS and HTML. `tools/format.mjs` uses the
same application part list as the build, formatting that shared closure as one
program before restoring file boundaries. Run `npm run format` to apply it or
`npm run format:check` to check it. Neither command edits coordinate manifests,
third-party dependencies, generated application files or embedded scientific
text. Rebuild after formatting so the source/runtime equality checks remain
meaningful.

## Equation preview contract

1. A source PDF is selected locally and fingerprinted. The coordinate-only manifest is used only for the matching edition.
2. The renderer obtains visible equations directly from the user's PDF through local PDF.js rendering.
3. The saved source geometry and individually reviewed exclusion masks remove unrelated content conservatively; the original glyphs are never retypeset or saved to disk.
4. Cropped content is scaled uniformly inside a fixed-size preview. **Open in PDF** remains the fallback for ambiguous regions.

**Regression requirement:** Preserve the **1,978 `anchorY` entries** and the 12 individually reviewed corrections. Tests assert that maintained and generated equation modules and manifests match exactly. See [Equation audit](EQUATION_AUDIT.md).

## Security and persistence

- PDF path: private user configuration file created by the Go launcher.
- Notes, bookmarks and reading progress: a versioned browser-local envelope per
  PDF fingerprint. The shared entry registry in `application/10-state-and-layout.js`
  distinguishes source rows and repeated index terms. `50-study-tools.js` owns
  migration, backup merging and explicit reassignment of ambiguous saved items.
  Old storage values remain available as a migration backup. Theme and layout
  preferences retain their existing independent storage.
- Recently viewed: at most three entity references or submitted queries per PDF
  fingerprint, managed in the existing navigation controller. References are
  resolved through the same entry registry on each session; source entry text
  and rendered images are not copied into this history. Legacy records with
  source locations migrate to the source-qualified keys. Search records keep
  their query and scope, independently of result pagination.
- Module install: source-only first launch may download version-pinned PDF.js program modules. A production release bundles them and requires no network download.
- No remote fonts, analytics, telemetry or third-party API calls are part of the Atlas web client.
- PDF-derived and user-provided text must be escaped before HTML insertion.
- Keep origin/host validation for the Go server's local endpoints and avoid adding unrestricted file-serving routes.

## Verification

Use `npm run build:source && npm run check && npm test && go test ./src/launcher` when dependencies are unavailable. For an offline release, use `npm ci --ignore-scripts --omit=optional && npm run format:check && npm run test:all && npm run release`. Both pathways verify generated application code. The browser and original-PDF tests in [Release validation](RELEASE_VALIDATION.md) are still required before declaring full visual coverage.

## Read-only figure previews

`src/client/figures/source-map.json` is the maintained coordinate map for the
supplied PDF. It contains page numbers, exact rectangles, optional exclusion
rectangles and ordered multi-page panels. The PDF SHA-256 and page count must
match before any of these coordinates are used. The map contains no artwork.

`pdf/source-regions.js` validates the coordinate format shared by figures and
tables. `figures/reviewed-crops.js` resolves figure parts and reconciles their
catalog entries after source matching. `renderer.js` owns the
render queue and canvas lifecycle. It renders only each reviewed rectangle,
using the existing local PDF.js document supplied by the equation renderer.
Figure 1 has separate Part 1 and Part 2 entries in the original panel order.
At most two figure previews render
concurrently, and a source change cancels pending work from the old PDF.

`geometry.js` is retained only as conservative detection for PDFs without a
matching coordinate map. An uncertain result shows **Open in PDF**. A figure
preview never embeds a complete page. Crop-editing controls, crop storage and
crop-editing events are removed; legacy stored rectangles are ignored.

The figure source map and its browser wrapper are generated by the normal
build, and static checks reject stale generated copies. Equations retain their
separate reviewed index and renderer. See [Figure previews](FIGURE_PREVIEWS.md)
for maintainer instructions.

## Table previews

The parallel `tables/` directory owns its coordinate map and renderer. The
renderer uses `AtlasSourceRegions` and the existing shared PDF.js document.
Catalog cards render only the first part and contain no nested controls. Detail
views render one part at a time, with a selector for multipage tables. Both
views fit the pane width through shared canvas styles. Their page-change
callback updates the existing detail-header **Open in PDF** destination.
`application/30-discovery.js` shares one visibility observer helper among
equation, figure and table cards. See [Table previews](TABLE_PREVIEWS.md) for
coverage, source checks and maintenance.

## Symbols and abbreviations

`application/40-catalog.js` owns the three notation categories, their filtering
and pagination, and their entry cards. Each entry is one native button using
the existing `collection-card` styling and `showEntity` navigation. Its stored
catalog index identifies the original object, including symbols with repeated
names. The existing `styles/20-symbol-table.css` source slot now contains the
card-content rules; the build order and module hierarchy are unchanged.

The PDF catalog extractor retains complete printed rows and their lettered
definitions, including the Meaning, Usual Units and Section cells. Plain-text
fields support search; explicit source runs preserve mathematical typography
through `science/notation.js`. The separate, lazy `pageTextPositions` pass leaves
the normal page text and block index in their existing reading order. Source
rows have stable table/page/baseline identifiers and source-derived migration
aliases. The detail renderer links exact indexed section references through
the existing `data-open-section` handler. See [Notation extraction](NOTATION_EXTRACTION.md).

## Catalog context and search results

`application/30-discovery.js` filters the existing five structured catalogs by
text and by chapter/appendix page intervals from the imported outline. Its
click handler passes the full matching list, including entries on other result
pages, into `showEntity` in `60-entity-details.js`. This explicit in-memory
context governs Previous/Next. Direct navigation starts without a list context;
redrawing the same entry after bookmarking retains it.

`navigation/controller.js` records the context with each entity history entry
and restores the catalog's query, chapter, page and scroll position. These
in-memory lists are never copied into persisted Recently Viewed data.

`application/70-search.js` ranks every match. The full results view uses the
existing pagination controls with a separate `searchPage` state field. The
navigation controller limits quick suggestions independently. Search history
includes the results page; only a submitted query updates Recently Viewed.

The static `#mainNav` buttons in `src/client/index.html` own destination labels,
order and view identifiers. The inline search menu reads those buttons through
`navigation/controller.js`, so both navigation surfaces expose the same routes.
The controller adds search-scope behavior to searchable destinations and routes
other buttons through the existing `goView`. Every empty category also offers
its complete view before individual entry previews. The dropdown wraps its
category buttons and allows vertical scrolling on short displays.

The **Concept index** and **Symbols & abbreviations** scopes remain distinct in
`application/70-search.js`, full-result pagination and persisted recent searches.
The older `glossary` scope continues to combine them for saved searches. Full
search reads supported scope values from the existing `#searchScope` control;
it does not maintain a separate, shorter category allowlist.
