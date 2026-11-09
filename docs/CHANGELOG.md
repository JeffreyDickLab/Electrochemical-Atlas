# Changelog

## 2026-11-06 — Matching sidebar and search navigation

- Renamed the existing Book map menu destination to **Chapters**, preserving
  its outline route and active-menu behavior.
- Generated search-menu destinations from the existing sidebar labels and
  routes, including Home, Study paths, Concept index, Symbols & abbreviations,
  Tables and References. The buttons wrap within the search dropdown.
- Added complete-view actions before category previews and kept every sidebar
  destination in the default quick-action list, even when recent items exist.
- Preserved selected categories when opening full search results. Added
  distinct concept and notation scopes while retaining legacy glossary search
  and the selected scope in Recently Viewed.
- Cleared the search field's active-result reference when a query has no
  matches, so keyboard and assistive navigation do not point to a removed row.

## 2026-11-06 — Complete notation, source-aware saved entries and catalog browsing

- Extracted complete printed symbol and standard-abbreviation rows, with each
  lettered meaning's units and sections. Preserved explicit source scripts,
  font distinctions and overbars through the existing science formatter.
- Added stable source-row identities and a shared resolver for bookmarks,
  notes, Recently Viewed and Back/Forward. Migrated unambiguous older items;
  retained ambiguous items and differing note versions for explicit attachment.
- Scoped study data to the selected PDF and updated backups to merge saved
  items while preserving conflicts and unassigned content.
- Linked exact indexed section references from notation detail pages through
  the existing section-opening handler.
- Removed the full-search result cap and added 50-result pagination with an
  accurate total and results-page history.
- Kept entry Previous/Next navigation within the complete filtered catalog.
- Added chapter, appendix and front-matter filtering beside the existing text
  filters for Figures, Tables, Equations, Problems and References.
- Extended focused source, migration and navigation regressions and maintained
  browser fixtures within the existing project structure.

## 2026-11-06 — Clickable notation cards and source-table sections

- Made each Symbols & Abbreviations preview a native collection-card button,
  using the existing entry navigation and the same card interaction as the
  other catalogs. Removed the obsolete table-cell presentation for this view.
- Kept the three notation categories, filtering and pagination. Cards show
  source-table section references for symbols and standard abbreviations, and
  source structure/equation references for chemical abbreviations.
- Corrected source-table section extraction to preserve the references belonging
  to each entry, including plain chapter numbers and subsection suffixes.
- Updated the existing source modules, regression fixtures and documentation.

## 2026-11-06 — Automatic table preview width

- Removed the catalog's Open to read message and the table zoom, Fit width and
  Previous/Next controls, including their unused state, handlers and styles.
- Catalog and detail table previews now fit the available width automatically.
  Catalog previews use their natural height, preserving the printed aspect ratio.
- Retained the page selector for multipage tables and the existing current-page
  Open in PDF link. Single-page tables have no control bar.
- Updated the existing table tests and maintainer documentation in place.

## 2026-11-06 — Separate figure parts, table previews and persistent recents

- Split Figure 1 into Part 1 and Part 2 catalog entries with the same description,
  separate source-page links and natural-height previews. Existing Figure 1
  bookmarks and notes resolve to Part 1; the reviewed crop coordinates are unchanged.
- Added reviewed previews for all 52 tables and 81 page parts. Detail views have
  page selection, Previous/Next, zoom and Fit width; Open in PDF follows the
  selected table page. Source rows and scientific notation are rendered directly.
- Moved shared source-region validation into the existing PDF layer and reused
  the existing PDF document and catalog visibility behavior.
- Replaced the sidebar's Continue Reading block with up to three Recently Viewed
  entries or submitted searches, saved locally per source PDF across sessions.
- Updated source, tests, build/package checks and maintainer documentation in the
  existing project hierarchy.

## 2026-11-06 — Direct catalog navigation

- Replaced **Browse entries** in the existing Menu with **Figures**, **Tables**,
  **Equations**, **Problems**, and **References**. Each uses the existing catalog
  route to reveal its list in the second column, including from PDF-only mode.
- Shared the first-column list's thin scrollbar rules with Atlas content.
- Kept the optional compact list on **Shift+L**, with category-aware return focus.
  A saved open-list preference no longer hides the main category buttons at startup.
- Removed a redundant mobile menu toggle that could reopen the overlay after
  selecting an entry or full catalog from the compact list.
- Adjusted the existing short-window menu breakpoint for the additional category
  buttons, retaining the established two-column layout on small screens.
- Kept these changes in the existing HTML, application, navigation, layout and
  stylesheet modules; rebuilt the generated runtime from maintained source.

## 2026-11-06 — Reviewed figures and maintainable source

- Visually reviewed all 564 figures from the supplied PDF and added explicit,
  edition-checked coordinates for 565 parts. The introductory structure plate
  retains both pages. See [Figure audit](FIGURE_AUDIT.md).
- Restored Figure 14.9.2 to the catalog when its printed label has no prose caption.
- Removed user crop editing, saved crop overrides and complete-page preview
  fallbacks. Unavailable previews retain the existing **Open in PDF** action.
- Separated reviewed-coordinate validation from the render queue and canvas
  lifecycle, with cancellation and late-result protection on source changes.
- Fixed shared PDF disposal to use the supported PDF.js loading-task API.
- Formatted maintained JavaScript, CSS and HTML, added a pinned formatter and
  lockfile, and documented source ownership, build order and figure maintenance.
- Added catalog, coverage, lifecycle and real-PDF rendering regressions. The
  equation coordinate index and native launcher contents are unchanged.
- Bundled the existing pinned PDF.js renderer in the revised offline package.
  Added its required CCITT/JBIG2 decoder and JavaScript fallback, fixing seven
  figures whose artwork could otherwise disappear while labels remained.
  Browser and cross-platform acceptance limits are recorded in the audit.

## Windows launcher and distribution clarity

- Added detailed missing-runtime and incomplete-extraction diagnostics to the Windows batch launcher.
- Added `README_WINDOWS.txt` and a dedicated reproducible Windows portable ZIP mode.
- The source archive still excludes compiled binaries; the Windows portable archive includes the native executable and all required application files.
- No equation renderer, index, scientific formatting, or reader behavior changes.

## 2026-11-03 — Figure preview empty-state fix (v6.30)

- Keep a visible source-page fallback for all valid figure entries whose
  automatic crop is uncertain. Do not mistake an ambiguous crop for a missing
  figure or present the old empty preview.
- If PDF.js is missing in a portable installation, display the source page in
  the browser's native PDF viewer. A first online launch still installs PDF.js
  for isolated, high-quality figure and equation previews.
- Add a **Crop** editor with draggable selection handles, optional neighboring
  page navigation, Save crop and Reset automatic. Only normalized coordinates
  are saved locally per SHA-256-identified user PDF; no artwork is bundled.
- Add coverage for source-page fallback, crop save/reset, renderer failure,
  responsive cards and five synthetic layouts. Original textbook PDF access
  is still needed to validate every automatically isolated figure visually.


## 2026-11-03 — Broader, caption-free figure preview coverage

- Locate printed figure numbers even when PDF text runs split the label,
  include trailing punctuation, place the label in a separate font size,
  or omit spacing between the word “Figure” and its number.
- Crop tall schematics, widely separated panels, light-gray/color graphics,
  and figures with captions above the artwork; retain panel and axis labels.
- Keep adjacent paragraphs and nearby figures out of the crop, including
  multiple labeled figures on the same page. Search one adjacent PDF page when
  the catalog and PDF.js disagree on a caption location.
- Reduce oversized source pages to a safe temporary render size instead of
  disabling the previews. Preserve all original PDF content locally and never
  ship thumbnails, artwork, a per-book figure crop catalog, or PDF images.
- Add synthetic geometry and browser regression tests. The original PDF is not
  included, so this expands automatic coverage without guaranteeing every
  original figure can be isolated without visual review.


## Maintenance sweep — November 3, 2026

- Preserve an existing PDF.js bundle during source-only client rebuilds, while excluding it from source ZIPs.
- Require the full responsive browser suite before publishing tagged GitHub releases.
- Bound individual browser-test runs and report the name of any stalled script.
- No changes to equation geometry, source-specific cropping, scientific calculations, or user data formats.

This file records behavior changes that affect users or maintainers. Visual and
scientific validation limitations are detailed in [Release validation](RELEASE_VALIDATION.md)
and [Equation audit](EQUATION_AUDIT.md).

## 2026-11-03 — Joined-word extraction repair

- Restore readable word boundaries where selectable PDF text has joined ordinary
  prose to adjacent words or circuit labels, including multiple joined words
  in one source run and missing spaces after sentence punctuation.
- Use a bounded, conservative grammatical word recognizer. Skip ambiguous
  tokens, proper names, bibliography references, and scientific identifiers.
- Improve the display of indexed electrical signals such as `e1`, `e2`, and
  `Z2` without changing stored catalog strings or equation-crop geometry.
- Add importer, display, and responsive browser regressions. Older imported
  entries are repaired when displayed; reimporting improves indexed text.

## 2026-11-03 — Multi-page problem continuity

- Preserve problem text across original PDF page breaks instead of treating a
  page boundary as the end of an entry. Track the last source page of a problem.
- Exclude intervening numbered figure/table captions and adjacent graph/tick/
  table-label blocks from problem statements. Resume prose after the insertion,
  including on the following page.
- Ignore recognized printed running headers and page folios in problem extraction.
- Protect short valid problem clauses and standalone mathematical expressions
  against accidental removal, and add regression coverage for both cases.
- No original textbook content, equation artwork, or changed equation coordinates
  are distributed. Unknown or uncaptioned insertions may still require review
  against the original PDF.

## 2026-11-03 — PDF extraction spacing and exponent repair

- Repair PDF font-boundary spacing that could combine an ordinary word and a number, or a molarity unit and the next charged species.
- Recognize common en-dash/minus variants in clearly scientific powers of ten, without misreading page ranges in citations.
- Preserve full chemical charges and unit powers when text is rendered, including in existing imported catalogs without requiring a new PDF import.
- Correct an importer edge case where an empty next-chapter subtitle could terminate extraction of problem entries prematurely.
- Add synthetic parser, formatter, and browser regressions to cover this family of extraction errors. Real PDF glyph placement remains the source of truth for ambiguous notation.

## 2026-11-03 — Scientific typography and source entry presentation

- Unify safe display-only superscripts, subscripts, explicit ionic charges, unit powers, and scientific notation across imported Figure/Table captions, Problems, References, symbol tables, search previews and calculator model descriptions.
- Preserve source Unicode Greek and mathematical symbols, including mixed baseline/script powers, without changing saved search/index strings or the original PDF.
- Format problem subparts, source caption paragraphs, and bibliography entries consistently; reference page ranges are not converted into exponents.
- Add unit and responsive-browser tests for notation, source-derived entry types and HTML escaping. Ambiguous extraction remains literal rather than being corrected from an unsupported guess.

## 2026-11-03 — PDF reader notifications

- Removed the transient “Opening [page] in your original PDF” popup when navigating PDF pages.
- Removed the obsolete popup markup, styling, loading timeout and event handlers while keeping the PDF failure message and Retry control.
- Fixed Retry so it reloads an unsuccessful iframe navigation even when the target page URL is unchanged.
- Added unit and synthetic browser regression tests to prevent the notification from returning.

## 2026-11-03 — Navigation, sidebar, and symbol tables

- Unified Menu and Browse into a two-level sidebar with one persistent width,
  one drag handle, and a filterable reference index. The redundant List button
  was removed from the top bar.
- Made Menu non-scrolling and kept a slim vertical scrollbar **only** in Browse.
  Continue reading and recently viewed entries remain anchored below either view
  when the viewport has sufficient height.
- Made abbreviations, Roman/Greek symbols, and chemical abbreviations responsive
  in both their tabs and tables; narrow panes use labeled entry rows.
- Consolidated the PDF viewer interface: the native viewer retains its controls,
  and subtle floating Hide bar / Show bar actions replace the custom reader strip.
- Removed unnecessary source-status captions, provenance headings, and the
  sidebar reading-progress bar without removing bookmarked or saved progress.
- Aligned Home shortcuts with the study-start section and standardized sidebar
  typography, colors, and spacing.

## 2026-11-03 — Repository maintenance

- Corrected obsolete browser-test assertions to reflect the current Browse
  scrollbar and persistent session shortcuts.
- Made browser tests platform-independent: Chromium may be provided by the
  environment or installed through Playwright; screenshots now go to an
  ignored artifacts directory instead of a machine-specific absolute path.
- Removed unused List-toggle CSS rules and hardened source packaging to reject
  symlinked files and directories.
- Retained the established equation renderer, its 1,978 number anchors, and
  the individually reviewed crop corrections.

## 2026-11-02 — Equation cropping and release preparation

- Restored printed-number-anchored equation cropping after a regression that
  had dropped 1,978 coordinate anchors. Preserved twelve reviewed corrections
  plus the additional full-structure crop for equation 1.4.15.
- Added fixed-size, proportional equation previews derived at runtime from the
  reader's own PDF, with matching background colors and mathematical-stroke safeguards.
- Separated source, portable and offline distributions, added deterministic ZIP
  packaging and source-to-generated consistency checks, and consolidated docs.
- Published the Atlas-owned original code under MIT, crediting Azaria A. Wagner
  and Jeffrey E. Dick; retained third-party notices and excluded the original book.

## Earlier development

- Introduced local PDF import, searchable indices, study paths, notes,
  bookmarks, calculators, responsive reading modes and cross-platform launchers.
