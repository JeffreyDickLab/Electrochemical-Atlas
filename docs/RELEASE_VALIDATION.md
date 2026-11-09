# Release validation checklist

There are four distribution types: **Windows portable** (single Windows launcher and app), plus the three cross-platform types: **source repository** (no compiled executables or PDF.js), **first-run portable** (five native launchers, PDF.js downloaded once online), and **offline release** (five native launchers plus locally bundled PDF.js). None ships the reference textbook, source pages, or equation images.

## Verification for the 6 November 2026 sidebar and search-menu update

| Check | Result |
| --- | --- |
| Formatting, generated build and static checks | Passed; 107 maintained files, 26 runtime JavaScript files and the offline PDF.js bundle |
| Complete unit suite | 235 passed, zero failed or skipped |
| Sidebar and search destination parity | All 12 sidebar destinations use the same labels and order in search; a synthetic added sidebar route appears automatically |
| Chapters route | The existing `book` destination is labeled Chapters and remains the only selected sidebar destination when opened |
| Inline search interactions | Six focused tests passed for focus, category selection, full-view actions, entry selection, scope retention and empty-result accessibility |
| Full-search and recent-history scope | Concept and notation searches stay distinct; the legacy glossary scope still combines them; recent scopes survive reload |
| Interactive browser acceptance | Not run; browser execution remains blocked in this environment |

The inline interaction checks execute the maintained controller with a small
DOM stand-in. They cover all destinations with three populated recent items,
every empty category's complete-view action, Enter selection, the full-results
button and Ctrl/Meta+Enter. A no-match query clears the selected-result ARIA
reference and later matches restore it. These tests do not establish physical
browser focus traversal, font metrics or CSS wrapping. The previous source-PDF
and rendering audits below remain historical checks; they were not repeated
for this navigation-only update.

## Verification for the earlier 6 November 2026 notation and navigation update

| Check | Result |
| --- | --- |
| Formatting, generated build and static checks | Passed; 106 maintained files, 26 runtime JavaScript files and 2,004 reconciled equation entries |
| Complete unit suite | 226 passed, zero failed or skipped |
| Independent source-table audit | All 544 printed notation rows, 641 definition groups and 1,665 rich-text cells match the supplied PDF |
| Complete notation coverage | 387 Roman/Greek symbols and 157 standard abbreviations; meaning-specific units, section references and source typography retained |
| Fresh full-PDF import | All 1,107 page texts, reader metadata, TOC, section hierarchy and non-notation catalogs unchanged |
| Legacy source-location resolution | All 373 previous notation records resolve to their corresponding new source rows |
| Identity round trips | All 6,799 entries in the combined catalog resolve to the original entries |
| Legacy saved-note migration | All 358 distinct legacy note keys preserved: 347 attach unambiguously and 11 remain available for explicit reassignment |
| Focused PDF regressions | Eleven passed, including complete table cells, nested scripts, font distinctions, overbars, stable source rows and legacy aliases |
| Search and navigation regressions | Passed full-result pagination, meaning-specific unit search, chapter boundaries, filtered entry navigation and history restoration checks |
| Updated browser-fixture syntax | Three Python files and 34 embedded JavaScript snippets parse successfully |
| Interactive browser acceptance | Not run; browser execution is blocked in this environment |

The independent audit reviewed every notation-table page in the supplied PDF
(PDF pages 27–49), including the opening Roman-symbol rows previously omitted by
the importer. It compares identifiers, every lettered meaning, units and section
references, along with superscripts, subscripts, bold/script lettering and
overbars. Equivalent traversal order of parallel scripts and sub-millipoint
coordinate rounding are normalized; no substantive discrepancies remain.
See [Notation extraction](NOTATION_EXTRACTION.md) for the data contract and
source-row identity rules.

Saved-data regressions cover source-specific identities, ambiguous legacy keys,
merge behavior, persistent recent entries, source mismatch handling and complete
preservation of large notes when reassigned. Old storage remains available as a
backup. The migration never guesses which duplicate printed identifier owns a
note; unresolved data appears under **Unassigned saved items**.

Browser fixtures now include chapter filtering and rich, multiple-meaning
notation cards. Their syntax and the DOM-level unit checks do not establish
actual browser layout, font metrics, keyboard operation or physical scrolling.
The following subsections record earlier validation; the complete figure and
table rendering runs listed there were not repeated for this update.

## Verification for the earlier 6 November 2026 notation-card update

| Check | Result |
| --- | --- |
| Formatting, generated build and static checks | Passed; 102 maintained files and 26 runtime JavaScript files |
| Complete unit suite | 198 passed, zero failed or skipped |
| Independent source-table audit | All 217 symbol and 156 abbreviation section strings match the supplied PDF |
| Fresh full-PDF import | All 1,107 page texts, reader metadata, TOC and section hierarchy preserved |
| Catalog identity and history compatibility | All 373 notation identifiers, PDF pages and record positions preserved; all 82 chemical records unchanged |
| Focused PDF regressions | Eight passed, covering row boundaries, reference syntax, text positioning and unsupported transforms |
| Updated browser-fixture syntax | Both Python files and 15 embedded JavaScript snippets parse successfully |
| Interactive browser acceptance | Not run; browser execution is blocked in this environment |

The source-table audit covers every existing catalog record. It preserves blank
Section cells, chapter numbers, ranges, subsection letters and references from
later meanings of an entry. Four abbreviation meanings had misplaced Section
text removed. The PDF positioning helper was independently reviewed for
inherited text state and graphics-state restoration; normal page text, block
output and cache behavior were checked against the previous implementation.

The updated browser fixtures exercise whole-card pointer targets, native Enter
and Space activation, all three notation categories, and narrow layouts in both
themes. Their syntax checks do not establish actual browser layout or keyboard
operation. The following subsection records the earlier preview and recents
validation.

## Verification for the 6 November 2026 preview and recents update

| Check | Result |
| --- | --- |
| Formatting, generated build and static checks | Passed; 101 maintained files and 26 runtime JavaScript files |
| Complete unit suite | 186 passed, zero failed or skipped |
| Packaging suite | All 7 checks passed |
| Real-PDF figure rendering | All 565 separate previews passed, covering 564 printed figures and 565 reviewed regions |
| Real-PDF table rendering | All 52 tables and 81 page parts passed, including page selection and source-link checks |
| PDF image decoding | Zero decoder warnings in the figure and table rendering runs |
| Recent-entry source resolution | All 217 symbols and all 3 appendices resolved to the exact current and reloaded catalog entries |
| Native Linux launcher | Passed local asset serving under both URL prefixes, two-tab lifecycle and clean shutdown |

The original figure coordinates, equation map and native executables remain
unchanged. The real-PDF runs use PDF.js and native canvas with a minimal DOM;
they do not establish browser layout or physical scrolling. Browser execution
was blocked in this environment, so interactive layout, keyboard operation and
native Windows/macOS acceptance were not performed. The relevant browser
fixtures and the public-release checks below remain available to maintainers.

## Before any public release

1. Confirm the project authorship, licensing authority and mandatory third-party notices. Confirm that the reference PDF is absent from the repository.
2. Run `npm ci --ignore-scripts --omit=optional` on a connected development machine. The exact PDF.js version in `package.json` must match the Go launcher pin.
3. Run `npm run test:all`, `go test ./src/launcher`, `go vet ./src/launcher`, and verify that `gofmt -l src/launcher/*.go` returns no files.
4. Run `python tests/browser/pdfjs_equation_smoke.py` and `npm run test:browser` using Python Playwright and Chromium. These exercise the local PDF.js engine and responsive navigation, source panels, and symbol cards using **synthetic** data, without the copyrighted textbook.
5. If a legitimately held matching book PDF is available, run `ATLAS_TEST_PDF=/path/to/book.pdf node tests/integration/pdf-import.mjs` and `ATLAS_TEST_PDF=/path/to/book.pdf python tests/browser/smoke.py`.
6. Inspect representative ordinary, multistep, wide and chemical-structure equation previews in catalog/detail mode and **Open in PDF**. Include the individually corrected entries, the complete 1.4.15 structure, and boxed/multiline cases; see [Equation audit](EQUATION_AUDIT.md).
7. Open the **Figures** catalog with the exact supplied PDF and verify its reviewed coordinate map. Inspect every changed crop against **Open in PDF**, including labels, panel boundaries, nearby captions and multi-page figures. The crop editor must be absent in both catalog and detail views. Run `figure-reviewed-crops.py` for fingerprint guards, exact bounds, exclusions, composite panels and cancelled renders; synthetic tests do not replace visual review of the actual PDF.
8. Run `ATLAS_TEST_PDF=/path/to/book.pdf node tests/integration/figure-previews.mjs` and `ATLAS_TEST_PDF=/path/to/book.pdf node tests/integration/table-previews.mjs` with the optional native canvas dependency installed. Inspect Figure 1's two separate entries and the Tables page selector. Resize the content pane to check automatic table width fitting, and confirm that Open in PDF follows the selected table page even when rendering fails. Source bounds and review coverage are documented in [Table previews](TABLE_PREVIEWS.md).
9. Open three different entries or submit searches, restart with the same PDF, and check Recently Viewed. Reopening an entry must move it to the top without duplication, and another PDF must have its own history. Include `sidebar-recents-layout.py` in the browser pass for populated footer layouts.
10. Test source and offline launchers on native Windows, macOS Intel/Apple Silicon and Linux systems before claiming OS-level compatibility. CI cannot validate each system's file-picker permissions or window-lifecycle behavior.
11. Run `npm run release -- --platform windows`, `macos`, or `linux` to build a platform ZIP. Verify each asset includes `app/vendor/pdfjs/pdf.mjs`, `pdf.worker.mjs`, the upstream `LICENSE`, all four decoder and notice files in `app/vendor/pdfjs-codecs/`, and the launchers for that platform. For the full offline bundle, run `npm run release` without a platform. The [publishing guide](GITHUB_PUBLISHING.md) covers the independent GitHub release jobs.

## Repository/source-only verification

Without npm packages or browser availability:

```sh
npm run build:source
npm run check
npm test
go test ./src/launcher
npm run package:source
```

This catches source/generated drift, broken equation index references, module syntax, packing errors, and known regressions. The source ZIP is suitable for a GitHub repository and deliberately excludes native binaries. For a runnable package needing a one-time online setup, run `npm run package:portable` after compiling the platform binaries. **It cannot demonstrate a working fully offline PDF.js runtime**; that requires step 2 onward on a connected development machine.

## Browser test portability

The synthetic browser checks run on any OS with `playwright` and Chromium
installed. By default, they use `/usr/bin/chromium` if present, otherwise
Playwright's own browser. Set `ATLAS_CHROME=/path/to/chromium` to override.
Optional screenshots are written to the ignored
`tests/browser/_artifacts/` directory, or to `ATLAS_BROWSER_ARTIFACTS`
when that environment variable is provided. Do not commit them.

The `npm run test:browser` command and both GitHub Actions workflows run the same synthetic
Menu/Browse, sidebar, responsive symbols, and PDF-overlay checks. Each script has a
180-second default timeout so CI names any stalled test; use
`ATLAS_BROWSER_TIMEOUT_SEC` to adjust the per-script limit. The PDF.js
fixture is a separate browser acceptance test. Tests using the full textbook
remain an optional local acceptance gate because the PDF is not distributed.

## Equation regression examples

- 1.3.1 / 1.3.19 / 6.6.7: reject adjacent prose or the following boxed equation.
- 1.3.7 / 1.3.22 / 1.1.24: erase only the PDF's decorative exterior frame; preserve all mathematical strokes and dimensional annotations.
- 2.1.34a,b / 3.7.15 / 10.4.3 / 11.4.23 / 13.3.64 / 18.4.7: verify upper/lower indices, long delimiters, complete chemical structures and unclipped right edges.
- All previews must use uniform outer dimensions and scale the full equation proportionally; visual white space may remain.

Automated geometry tests and a sample of visual checks do not prove complete correctness of every indexed formula. Review exceptions individually when reported.

## Windows installation checks

- On Windows, download the **Windows portable** or full **offline release** ZIP, not the source ZIP.
- In File Explorer, use **Extract All** and keep `Launch_Electrochemical_Atlas.bat`, `runtime/atlas-windows-amd64.exe`, and `app/index.html` together. Do not run a batch file directly from a compressed folder.
- Run `python3 tools/package.py --mode windows` after building the Windows executable to generate the reproducible Windows package. The Windows packager fails if the EXE is missing.
- The Windows GitHub Release asset is uploaded by its own job. Use it on Windows.
