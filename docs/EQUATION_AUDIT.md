# Equation geometry: verification and safeguards

Electrochemical Atlas stores a source-position index, **not equation art**. The indexed third edition has 1,107 PDF pages and 2,004 named equation references: 2,000 standalone regions and four composite references. The renderer compares the user's source PDF fingerprint before applying the edition-specific geometry.

## Protected behavior

- The current source map includes **1,978 `anchorY` coordinates** used to identify the relevant mathematical row and exclude neighboring prose and equation numbers.
- Twelve equation-specific focus rectangles were subsequently reviewed: **2.1.34a,b, 3.7.15, 10.4.3, 11.4.23, 13.1.14, 13.3.6, 13.3.23a, 13.3.53, 13.3.64, 17.2.36, 17.2.38, 18.4.7**.
- Additional individually checked boundaries include **1.6.14, 2.1.58, 2.3.31, 2.3.44, 2.3.49, 3.1.10, 3.3.5a, 3.3.5b, 3.3.6a, 3.3.9b, 3.4.5, 3.4.16a, 3.4.22a, 3.4.22b, 3.4.32, 3.4.34, 3.5.5, 3.5.6, 3.5.7, 3.5.9, 3.5.14–3.5.17**, plus **3.1.2a, 7.2.37, 7.2.41, 11.2.3, 11.2.5**.
- **1.4.15** is a manually protected chemical-reaction diagram. Its focused rectangle includes detached functional-group labels and bonds above and below the aromatic rings; automatic vertical ink-band trimming is disabled only for this entry.
- The generated renderer and manifest must be exactly synchronized with maintained source, to prevent silently losing anchor metadata again.

The algorithm uses source coordinates and narrowly scoped exclusion masks, then trims background ink and fits the result inside a uniform frame. It is not a semantic mathematical OCR engine. A cropped fraction bar, superscript, radical, reaction arrow, or chemical structure can be scientifically wrong; **conservative retention and PDF fallback are preferable to deleting questionable marks**.

## Reproducible checks

The coordinate-only audit dataset is [`EQUATION_BOUNDARY_REVIEW.json`](EQUATION_BOUNDARY_REVIEW.json). It contains source positions and warnings, not PDF text or graphics. A flagged region is **not proof of an error**.

Maintainers who independently possess the matching PDF can repeat the scan without writing publisher graphics to this repository:

```sh
python -m pip install PyMuPDF Pillow
python tools/maintainers/audit_equation_boundaries.py /path/to/book.pdf \
  --report /path/outside/repository/boundary-review.json
python tools/maintainers/check_source_equations.py /path/to/book.pdf \
  --report /path/outside/repository/source-equation-audit.json
```

The optional `tools/rebuild-equation-geometry.py` generates a **separate candidate file** and preserves reviewed focus rectangles, exclusion masks, frames and anchors by default. Replacing reviewed annotations requires `--replace-reviewed`, followed by an explicit source-PDF comparison.

Run the geometry and renderer regression tests (`npm test`) and visual PDF.js/browser checks documented in [Release validation](RELEASE_VALIDATION.md). These checks establish **structural** integrity and sampled source fidelity. They do not constitute complete manual proofreading of all 2,004 previews.

The original textbook PDF and generated visual comparisons are intentionally excluded from Git and release ZIPs.
