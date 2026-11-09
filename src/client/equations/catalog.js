/** Map source-positioned equations to source PDF pages without fuzzy text extraction. */
((root, factory) => {
  'use strict';
  const api = factory();
  if (root) root.AtlasEquationIndex = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : null, () => {
  'use strict';
  function reconcile(result, manifest, sourceSha) {
    if (!manifest || sourceSha !== manifest.pdf_sha256) return false;
    const byLabel = new Map(result.catalog.equations.map(item => [item.label, item]));
    const sections = result.catalog.sections;
    result.catalog.equations = Object.entries(manifest.entries)
      .map(([label, entry]) => {
        const existing = byLabel.get(label);
        const location = sections
          .filter(
            section =>
              Number(section.pdf_page) <= entry.page && Number(section.pdf_page_end) >= entry.page
          )
          .sort((a, b) => Number(b.level) - Number(a.level))[0];
        const context = `In ${location?.title || 'the original textbook'}.`;
        // Reviewed rectangles use top-left viewport coordinates. Keep them
        // separate from text-extracted y values in bottom-origin PDF points.
        const firstPart = entry.parts
          ?.map(part => manifest.entries[part])
          .find(part => part?.page === entry.page);
        const target = firstPart || entry;
        const sourceTop = (target.focus || target.crop)?.[1];
        return {
          ...existing,
          label,
          title: `Equation ${label}`,
          pdf_page: entry.page,
          printed_page: result.pages[entry.page - 1]?.printed_page || existing?.printed_page || '',
          y: existing?.pdf_page === entry.page ? Number(existing.y) || 0 : 0,
          sourceTop: Number.isFinite(sourceTop) && sourceTop >= 0 ? sourceTop : undefined,
          context: existing?.context || context,
          description: existing?.description || context,
          source_kind: 'Numbered equation in the selected source PDF'
        };
      })
      .sort(
        (a, b) =>
          a.pdf_page - b.pdf_page || a.label.localeCompare(b.label, undefined, { numeric: true })
      );
    result.catalog.meta.counts.equations = result.catalog.equations.length;
    return true;
  }
  return Object.freeze({ reconcile });
});
