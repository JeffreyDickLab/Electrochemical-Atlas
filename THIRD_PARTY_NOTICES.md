# Third-party notices

The Atlas-owned source code is released under MIT. The following material is **not** credited as Atlas-authored software or relicensed by MIT. Its separate copyright and licensing requirements continue to apply.

## Reference textbook (not included)

*Electrochemical Methods: Fundamentals and Applications*, third edition (2022), Allen J. Bard, Larry R. Faulkner and Henry S. White, published by John Wiley & Sons.

The book, its PDF pages and its original artwork are **not distributed** with the Atlas. Readers select their own local copy. Source-coordinate references in the Atlas do not grant permission to reproduce or redistribute the publisher's work.

## PDF.js

The application uses Mozilla's `pdfjs-dist` distribution, version pinned in `package.json`. PDF.js is copyrighted by Mozilla and its contributors and is licensed under **Apache License 2.0**, independently of the Atlas software license.

- An **offline build** copies the official PDF.js display module, worker module, and upstream `LICENSE` into `app/vendor/pdfjs/`.
- Runnable packages also include the CCITT/JBIG2 decoder at
  `app/vendor/pdfjs-codecs/`: `jbig2.wasm`, `jbig2_nowasm_fallback.js`,
  `LICENSE_JBIG2`, and `LICENSE_PDFJS_JBIG2`. These files are copied verbatim
  from the same pinned PDF.js distribution. Its PDFium-derived decoder carries
  the retained BSD-style notice in `LICENSE_JBIG2`; the Mozilla wrapper carries
  the separate Apache-2.0 notice in `LICENSE_PDFJS_JBIG2`.
- A **source-only checkout** may download those program modules from version-pinned CDN URLs on first launch and cache them locally. No source PDF or study information accompanies that request.
- Source archives omit generated vendor assets. Run the full `npm run build`
  after installing dependencies to supply the decoder and complete raster
  figure previews. First-run portable packages already include the decoder;
  the existing native launcher downloads only the core program modules.
- Retain the upstream notices with every redistribution of PDF.js. The Apache-2.0 license is included in [`licenses/PDFJS-Apache-2.0.txt`](licenses/PDFJS-Apache-2.0.txt).

Source: https://github.com/mozilla/pdf.js

No publisher endorsement or affiliation is implied by this software.
