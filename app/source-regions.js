/**
 * Validate reviewed source regions for an exact PDF edition.
 *
 * Rectangles use PDF points measured from the displayed page's top-left corner:
 * [left, top, right, bottom]. Lookups return copies of the maintained geometry.
 */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasSourceRegions = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';

  const COORDINATE_SYSTEM = 'pdf-points-top-left';
  const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;

  function normalizeLabel(label) {
    return String(label || '')
      .trim()
      .replace(/\s*\.\s*/g, '.')
      .toLowerCase();
  }

  function validRectangle(rectangle) {
    return (
      Array.isArray(rectangle) &&
      rectangle.length === 4 &&
      rectangle.every(Number.isFinite) &&
      rectangle[0] >= 0 &&
      rectangle[1] >= 0 &&
      rectangle[2] > rectangle[0] &&
      rectangle[3] > rectangle[1]
    );
  }

  function matchesDocument(manifest, fingerprint, pageCount) {
    return Boolean(
      manifest &&
        typeof fingerprint === 'string' &&
        FINGERPRINT_PATTERN.test(fingerprint) &&
        FINGERPRINT_PATTERN.test(String(manifest.pdf_sha256 || '')) &&
        manifest.pdf_sha256.toLowerCase() === fingerprint.toLowerCase() &&
        manifest.pdf_pages === pageCount &&
        manifest.coordinate_system === COORDINATE_SYSTEM
    );
  }

  function validPart(part, pageCount) {
    return Boolean(
      part &&
        Number.isInteger(part.page) &&
        part.page >= 1 &&
        part.page <= pageCount &&
        validRectangle(part.crop) &&
        (part.exclude === undefined ||
          (Array.isArray(part.exclude) && part.exclude.every(validRectangle)))
    );
  }

  /** Return a copy so rendering cannot mutate the maintained source map. */
  function findParts(manifest, label) {
    const wanted = normalizeLabel(label);
    const entry = Object.entries(manifest?.entries || {}).find(
      ([key]) => normalizeLabel(key) === wanted
    )?.[1];
    if (!entry) return null;
    const parts = Array.isArray(entry.parts) ? entry.parts : [entry];
    if (parts.length === 0 || !parts.every(part => validPart(part, manifest.pdf_pages)))
      return null;
    return parts.map(part => ({
      page: part.page,
      crop: [...part.crop],
      exclude: (part.exclude || []).map(rectangle => [...rectangle])
    }));
  }

  /** Reject misplaced coordinates; never silently expand to a whole page. */
  function fitsPage(part, viewport) {
    return (
      validPart(part, Number.MAX_SAFE_INTEGER) &&
      Number.isFinite(viewport?.width) &&
      Number.isFinite(viewport?.height) &&
      part.crop[2] <= viewport.width + 0.01 &&
      part.crop[3] <= viewport.height + 0.01
    );
  }

  return Object.freeze({
    COORDINATE_SYSTEM,
    normalizeLabel,
    validRectangle,
    matchesDocument,
    validPart,
    findParts,
    fitsPage
  });
});
