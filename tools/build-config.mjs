/** Single source of truth for generated runtime files and ordered bundles. */
export const browserModules = Object.freeze({
  'text-utils.js': 'core/text.js',
  'storage.js': 'core/storage.js',
  'equation-index.js': 'equations/catalog.js',
  'equation-geometry.js': 'equations/geometry.js',
  'pdf-core.js': 'pdf/pdf-core.js',
  'runtime-catalog.js': 'pdf/catalog-extractor.js',
  'source-audit.js': 'pdf/source-audit.js',
  'pdf-file-memory.js': 'pdf/file-memory.js',
  'portable-source.js': 'pdf/portable-source.js',
  'reader.js': 'pdf/reader.js',
  'equation-preview.js': 'equations/renderer.js',
  'source-regions.js': 'pdf/source-regions.js',
  'figure-reviewed-crops.js': 'figures/reviewed-crops.js',
  'figure-geometry.js': 'figures/geometry.js',
  'figure-preview.js': 'figures/renderer.js',
  'table-preview.js': 'tables/renderer.js',
  'science-format.js': 'science/notation.js',
  'calculator-core.js': 'calculators/models.js',
  'calculator-ui.js': 'calculators/ui.js',
  'reading-chrome.js': 'reader/chrome.js',
  'bootstrap.js': 'import/bootstrap.js',
  'layout-controller.js': 'layout/controller.js',
  'navigation.js': 'navigation/controller.js',
  'catalog-rail.js': 'navigation/catalog-rail.js',
  'toolbar.js': 'navigation/toolbar.js'
});

export const applicationParts = [
  '00-context.js',
  '10-state-and-layout.js',
  '20-home-and-book-map.js',
  '30-discovery.js',
  '40-catalog.js',
  '50-study-tools.js',
  '60-entity-details.js',
  '70-search.js',
  '80-events.js'
];
