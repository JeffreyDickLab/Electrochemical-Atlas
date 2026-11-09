# Maintaining figure previews

## Where to make a change

| File | Responsibility |
| --- | --- |
| `src/client/figures/source-map.json` | Reviewed coordinates for the supplied PDF |
| `src/client/pdf/source-regions.js` | Shared coordinate validation and exact source matching |
| `src/client/figures/reviewed-crops.js` | Figure-part lookup and catalog reconciliation |
| `src/client/figures/renderer.js` | Queue, PDF.js rendering, temporary canvases and status messages |
| `src/client/figures/geometry.js` | Conservative detection for other source PDFs |
| `src/client/styles/21-figure-preview.css` | Figure frames and responsive sizing |
| `tests/unit/figure-reviewed-crops.test.cjs` | Coordinate validation and edition guards |
| `tests/integration/figure-previews.mjs` | Real-PDF catalog coverage, every rendered part, and source cancellation |
| `tests/browser/figure-reviewed-crops.py` | Pixel bounds, masks, labels, multi-page figures and removed controls |

Edit maintained files under `src/client/`. The normal build generates `app/`.
Do not edit the generated JavaScript or CSS separately.

## Coordinate format

The map declares the exact PDF SHA-256, page count and coordinate system:
`pdf-points-top-left`. Rectangles are `[left, top, right, bottom]` in PDF points
from the displayed page's top-left corner. Page numbers are one-based PDF page
numbers, including front matter. They are not printed textbook page labels.

A normal entry has `page` and `crop`. Optional `exclude` rectangles mask nearby
caption fragments that lie within the figure's overall bounding rectangle.
Use these only after checking the actual page; they must never remove axes,
legends, panel letters or meaningful labels.

A figure that spans several pages uses `parts`, an ordered list of objects
with `page`, `crop` and optional `exclude`. For the matching PDF, import
reconciliation creates a separately named catalog entry for each part. Figure 1
therefore appears as **Figure 1 (Part 1)** and **Figure 1 (Part 2)**, each with the
same imported description and its own source page. Their `source_label` and
one-based `source_part` retain the connection to the original figure. The
original `figure-1` bookmark/note key aliases to Part 1. Lookup of an unsuffixed
multipart label remains available for compatibility and renders the parts in
order. A single-page figure should use one crop when the complete figure
can be captured without unrelated text. The manifest is coordinate data only;
do not add images, encoded pixels or copied PDF pages.

## Changing a boundary

1. Render the correct source page and inspect the figure visually. Check every
   panel and its outermost labels. Use the printed caption to identify the
   figure, but keep the caption outside the preview rectangle.
2. Adjust only the affected entry. The source PDF remains unchanged.
3. Render the updated crop and inspect it at readable size. If the figure has
   multiple panels or pages, compare the result with all source pages.
4. Run `npm run build:source`, `npm run check`, `npm test` and
   `python3 tests/browser/figure-reviewed-crops.py`.
5. Open the Figures catalog and the entry's detail page with the actual PDF.
   Verify that both show the full reviewed figure at desktop and narrow widths.

An all-figure audit must record every reviewed figure. Unit and synthetic
browser tests verify the rendering rules, but cannot decide whether a crop
includes the correct scientific content.

The completed review of all 564 figures is recorded in
[Figure audit](FIGURE_AUDIT.md). Its JSON record identifies every reviewed
label and the hash of the coordinate map. When changing a boundary, visually
review the new result and update that audit record with the new review date
and map hash.

## Runtime behavior

- A matching PDF uses only reviewed coordinates. Missing or invalid reviewed
  data produces an unavailable state rather than a guessed or complete-page
  image.
- A different PDF cannot use the supplied edition's coordinates. Conservative
  caption/graphics detection may show an isolated figure; uncertain entries
  retain the existing **Open in PDF** path.
- Two previews can render concurrently. Selecting another PDF invalidates the
  queue and cancels the old render tasks.
- The renderer reads no saved crop preferences and exposes only `setSource`
  and `mount`. There is no crop dialog, draggable selection, crop action or
  user crop storage path.
- The PDF.js document is shared with equation previews. Figure canvases stay
  in memory and are reclaimed with their removed DOM elements. Temporary
  canvases are cleared after use. Previewing does not upload or export art.
- Part entries use a natural-height, full-width frame. Ordinary figure cards
  retain their existing fixed preview frames.

## Build and release checks

`tools/build.mjs` emits both `app/figures/source-map.json` and its browser
wrapper. `tools/check.mjs` validates the manifest and rejects stale generated
copies or a reintroduced crop editor. `tools/package.py` requires all figure
modules and the map in portable packages. The source PDF and rendered review
images are not included in the distributable program.

`tools/pdfjs-assets.json` lists the required core renderer and decoder files.
The full build installs the decoder at `app/vendor/pdfjs-codecs/`, a separate
static path supported by the existing native launchers. Do not move it under
`app/vendor/pdfjs/`: that native endpoint permits only the two core module
filenames. Offline, Windows and first-run portable packages must contain the
decoder and its notices. Source archives omit generated vendor files and need
a full build before they can render the supplied PDF's CCITT images correctly.
