# Figure review — 6 November 2026

## Scope and result

The supplied PDF contains **564 indexed figures**, represented by **565 crop
rectangles**. Every figure was visually inspected. Introductory Figure 1 spans
PDF pages 52 and 53 and is displayed as two ordered parts. All other figures
use one rectangle, including figures with several panels inside that rectangle.

The previews retain axes, units, legends, panel letters, chemical names and
other labels that belong to the figure. Printed figure captions, surrounding
prose, equations outside the figure, running headers, footnotes and neighboring
figures are excluded. The entry's descriptive caption remains separate in the
catalog; it is not included in the preview image.

The maintained coordinates are in
[`src/client/figures/source-map.json`](../src/client/figures/source-map.json).
[`FIGURE_REVIEW.json`](FIGURE_REVIEW.json) records every reviewed label, the
coverage counts, source fingerprint and hash of the reviewed coordinate map.
Neither file contains source artwork or copied PDF pages.

## Source identity

- Book: *Electrochemical Methods: Fundamentals and Applications*, third edition.
- PDF pages: 1,107, including front matter.
- SHA-256: `c8f275c377e9fa981b6b4e69a63aa20b675acb846fe516531837cef93a96fb44`.
- Coordinates: PDF points measured from the displayed page's top-left corner.
- Page references in the map are one-based PDF page numbers, not printed page labels.

The application applies these coordinates only when both the fingerprint and
page count match. A different PDF cannot silently receive this edition's crops.

## Coverage

| Chapter or section | Figures |
| --- | ---: |
| Introductory Figure 1 | 1, with two parts |
| 1 | 39 |
| 2 | 21 |
| 3 | 27 |
| 4 | 10 |
| 5 | 29 |
| 6 | 22 |
| 7 | 26 |
| 8 | 20 |
| 9 | 15 |
| 10 | 24 |
| 11 | 37 |
| 12 | 28 |
| 13 | 34 |
| 14 | 30 |
| 15 | 33 |
| 16 | 26 |
| 17 | 36 |
| 18 | 20 |
| 19 | 23 |
| 20 | 30 |
| 21 | 19 |
| Appendix A | 7 |
| Appendix B | 7 |
| **Total** | **564** |

Figure **14.9.2**, on PDF page 707, has a bold printed figure number without a
prose caption. The previous importer discarded it because its description was
too short. The importer now accepts that printed label while continuing to
reject ordinary prose references. A regression test covers both cases.

## Review method

Coordinate proposals were rendered from the supplied PDF and inspected one
figure at a time on readable contact sheets. Incorrect proposals were checked
against full source pages, adjusted with explicit coordinates, and rendered
again for inspection. The review specifically checked side captions, adjacent
figures, tall plots, small circuits, multipanel drawings, axis units and the
two-page introductory structure plate.

All 174 figures in chapters 1–7 also received an independent second visual pass.
That pass refined the left edge of Figure 1.6.5 to retain the entire circuit
terminal. A final text-span check identified a clipped unit in Figure 20.2.6;
the corrected crop was rendered and inspected again.

All 565 final rectangles lie within their source pages. The final boundary
check found **zero partially clipped PDF text spans**. This is supplemental
evidence: a geometric or nonblank-image check cannot determine whether a figure
contains the correct scientific content, which is why every figure was also
reviewed visually.

## Code changes supporting the review

- Reviewed coordinates and their validation are separate from rendering and
  generic detection. The renderer's named functions cover queueing, source
  changes, page painting, composition, display and status messages.
- User crop buttons, selection handles, editor dialogs, crop events and crop
  persistence were removed. Legacy saved rectangles are not read or applied.
- Matching-source previews use the reviewed map. An unavailable preview offers
  **Open in PDF**; a complete source page is never substituted into a figure card.
- Pending and active work from a previous PDF is discarded or cancelled before
  it can replace a current preview. Shared PDF resources are released through
  the PDF.js loading task when the source changes.
- The local PDF.js CCITT/JBIG2 decoder and JavaScript fallback are bundled with
  their upstream notices. In this PDF.js version, seven figures use compressed
  graphics that require this decoder. Without it, their labels could render
  while the actual image was silently omitted.
- Maintained JavaScript, CSS and HTML have consistent formatting. The formatter
  preserves the application's existing shared closure and module order.
- The equation coordinate index is byte-identical to the supplied program,
  including its 2,004 references and 1,978 printed-number anchors.

## Verification and limits

The final unit suite passed **143/143 tests**, package integration passed
**6/6 tests**, and the formatting check found no changes needed across **95
maintained files**. The formatting-only pass also compared the syntax trees of
the assembled application and 23 standalone browser modules with their prior
versions; all 24 matched after ignoring comments, locations and equivalent
literal spelling. Intentional renderer, importer and loader changes were
checked separately through the behavioral tests.

The verification includes source/generated consistency, unit regressions,
package-mode tests, the compiled Linux launcher lifecycle, real-PDF catalog
coverage, and PDF.js rendering of every figure and each individual part.
The real renderer test also checks the absence of crop controls and storage
access, bounded concurrent work, cancellation and late source-load completion.
It fails on image-decoding warnings, so a preview containing only labels cannot
hide a missing decoder. The seven affected figures (9.4.1, 9.5.1, 9.5.2, 9.6.1,
9.9.2, 10.2.5 and 10.5.1) were also checked with WebAssembly disabled to verify
the bundled JavaScript fallback. A negative control without decoder assets
failed as expected.

Both native HTTP routes serve the installed decoder files byte for byte, with
the proper WebAssembly content type. The assets use the ordinary static route,
outside the unchanged native launcher's restricted core-module endpoint.

The Node integration test uses the pinned PDF.js 6.4.299 **legacy build for
Node**, native canvas and a small DOM stand-in. It executes the maintained
figure renderer with the real PDF. It does **not** establish browser layout,
file-picker behavior or end-to-end desktop/mobile interaction correctness.
Browser execution was blocked in the review environment, so those browser
acceptance tests were not completed. Windows and macOS launchers are included
from the supplied package and were not executed here. The Go compiler was not
available; the launcher source and binary contents were not changed.

The browser tests remain in the package for a normal development environment.
Run the following from the project directory:

```sh
npm ci --ignore-scripts --include=optional
npm run format:check
npm run build
npm run check
npm test
npm run test:package
ATLAS_TEST_PDF=/path/to/the/supplied.pdf node tests/integration/figure-previews.mjs
ATLAS_TEST_PDF=/path/to/the/supplied.pdf node tests/integration/pdf-import.mjs
```

The optional native canvas dependency is needed only for the real-PDF Node
renderer test. Ordinary users run the packaged native launcher and select
their PDF; they do not need Node, npm, Python or Go.

See [Figure maintenance](FIGURE_PREVIEWS.md) for boundary changes and
[Release validation](RELEASE_VALIDATION.md) for browser and platform checks.
