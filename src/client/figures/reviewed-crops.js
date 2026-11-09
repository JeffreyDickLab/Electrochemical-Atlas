/**
 * Read-only figure regions and catalog entries for one exact source PDF.
 *
 * Multipage figures have one catalog entry per reviewed part. The maintained
 * geometry keeps its original printed figure labels and is never modified.
 */
((root, factory) => {
  'use strict';
  const regions =
    root?.AtlasSourceRegions ||
    (typeof module === 'object' && module.exports ? require('../pdf/source-regions.js') : null);
  const api = factory(regions);
  if (root) root.AtlasReviewedFigureCrops = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, regions => {
  'use strict';

  const { COORDINATE_SYSTEM, normalizeLabel, validRectangle, matchesDocument, fitsPage } = regions;

  /** Resolve a catalog part to exactly one of the original reviewed regions. */
  function findParts(manifest, label) {
    const wanted = normalizeLabel(label);
    const exact = Object.keys(manifest?.entries || {}).some(key => normalizeLabel(key) === wanted);
    if (exact) return regions.findParts(manifest, label);
    const match = wanted.match(/^(.+) \(part ([1-9]\d*)\)$/);
    if (!match) return null;
    const parts = regions.findParts(manifest, match[1]);
    if (!parts || parts.length < 2) return null;
    const selected = parts[Number(match[2]) - 1];
    return selected ? [selected] : null;
  }

  /**
   * Add the reviewed source location, or split an imported
   * figure into its reviewed parts. Captions stay source-derived, and an old
   * whole-figure bookmark/note points to Part 1.
   */
  function reconcile(result, manifest, fingerprint) {
    const catalog = result?.catalog;
    if (
      !matchesDocument(manifest, fingerprint, catalog?.meta?.pdf_pages) ||
      !Array.isArray(catalog.figures)
    )
      return false;

    let changed = false;
    const aliases = { ...catalog.entity_aliases };
    const figures = catalog.figures.flatMap(figure => {
      const parts = regions.findParts(manifest, figure.label);
      if (!parts) return [figure];
      if (parts.length === 1) {
        const [{ page, crop }] = parts;
        const sourceTop = crop[1];
        const sourcePage = page === figure.pdf_page ? undefined : page;
        if (sourcePage === figure.sourcePage && sourceTop === figure.sourceTop) return [figure];
        changed = true;
        const entry = { ...figure, sourceTop };
        if (sourcePage === undefined) delete entry.sourcePage;
        else entry.sourcePage = sourcePage;
        return [entry];
      }
      changed = true;
      const entries = parts.map((part, index) => {
        const label = `${figure.label} (Part ${index + 1})`;
        return {
          ...figure,
          label,
          title: `Figure ${label}`,
          source_label: figure.label,
          source_part: index + 1,
          pdf_page: part.page,
          sourceTop: part.crop[1],
          printed_page:
            result.pages?.[part.page - 1]?.printed_page ??
            result.reader?.labels?.[part.page - 1] ??
            (part.page === figure.pdf_page ? figure.printed_page : '')
        };
      });
      aliases[`figure-${figure.label}`] = `figure-${entries[0].label}`;
      return entries;
    });
    if (changed) {
      catalog.figures = figures;
      catalog.entity_aliases = aliases;
      catalog.meta.counts.figures = figures.length;
    }
    return true;
  }

  return Object.freeze({
    COORDINATE_SYSTEM,
    normalizeLabel,
    validRectangle,
    matchesDocument,
    findParts,
    fitsPage,
    reconcile
  });
});
