/** Static output verification; no extra npm packages or internet required. */
import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserModules, applicationParts } from './build-config.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(project, 'app');
const source = join(project, 'src', 'client');
let count = 0;
const fail = message => {
  throw new Error(message);
};
for (const file of (await readdir(app)).filter(f => f.endsWith('.js'))) {
  const check = spawnSync(process.execPath, ['--check', join(app, file)], { encoding: 'utf8' });
  if (check.status !== 0) fail(`${file}: ${check.stderr}`);
  count++;
}
// Detect stale checked-in web artifacts. A previous update accidentally
// restored old equation code and dropped source anchors from app/; checking the
// generated output against maintained source prevents that regression.
for (const [output, input] of Object.entries(browserModules)) {
  const [expected, built] = await Promise.all([
    readFile(join(source, input), 'utf8'),
    readFile(join(app, output), 'utf8')
  ]);
  if (expected !== built)
    fail(`Generated ${output} differs from src/client/${input}. Rebuild from source.`);
}
const appPieces = await Promise.all(
  applicationParts.map(name => readFile(join(source, 'application', name), 'utf8'))
);
const expectedApplication = appPieces
  .map((value, index) => `/* src/client/application/${applicationParts[index]} */\n${value}`)
  .join('\n');
if ((await readFile(join(app, 'app.js'), 'utf8')) !== expectedApplication)
  fail('Generated app.js is stale. Rebuild from source.');
const styleNames = (await readdir(join(source, 'styles'))).filter(n => n.endsWith('.css')).sort();
const cssPieces = await Promise.all(
  styleNames.map(name => readFile(join(source, 'styles', name), 'utf8'))
);
const expectedCSS = cssPieces
  .map((value, index) => `/* ${styleNames[index]} */\n${value.trimEnd()}\n`)
  .join('\n');
if ((await readFile(join(app, 'atlas.css'), 'utf8')) !== expectedCSS)
  fail('Generated CSS is stale. Rebuild from source.');
if (
  (await readFile(join(app, 'index.html'), 'utf8')) !==
  (await readFile(join(source, 'index.html'), 'utf8'))
)
  fail('Generated HTML is stale. Rebuild from source.');

const html = await readFile(join(app, 'index.html'), 'utf8');
for (const [, rel] of html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)) {
  if (/^(https?:|data:)/.test(rel)) fail(`An external dependency was introduced: ${rel}`);
  await access(join(app, rel));
}
if (!html.includes('href="atlas.css"')) fail('Missing canonical CSS bundle');
const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
if (!html.includes('<title>Electrochemical Atlas</title>')) fail('App title is inconsistent');
if (/atlas-build-chip|data-atlas-build|atlas-version|v__VERSION__/.test(html))
  fail('A visible version indicator remains in the application');
if (!html.includes('aria-label="Electrochemical Atlas"'))
  fail('Missing version-free navigation label');
const go = await readFile(join(project, 'src/launcher/main.go'), 'utf8');
if (!go.includes(`const appVersion = "${pkg.version}"`)) fail('Go version is inconsistent');
if (!go.includes('const appEntry = "/atlas/app/index.html"')) fail('Go app route is inconsistent');
const goRenderer = await readFile(join(project, 'src/launcher/renderer.go'), 'utf8');
if (!goRenderer.includes(`const pdfjsVersion = "${pkg.dependencies['pdfjs-dist']}"`))
  fail('The Go first-launch PDF.js pin differs from package.json');
for (const name of ['LICENSE', 'NOTICE.txt', 'COPYRIGHT_HOLDERS.md', 'THIRD_PARTY_NOTICES.md'])
  await access(join(project, name));
const requiredNotices = await readFile(join(project, 'NOTICE.txt'), 'utf8');
if (
  !requiredNotices.includes('Copyright © 2026 Azaria A. Wagner and Jeffrey E. Dick') ||
  /Dick Lab|current members|November 1, 2026/i.test(requiredNotices)
)
  fail('Project attribution notice is inconsistent with the two credited authors');
const manifest = JSON.parse(await readFile(join(app, 'equations/source-map.json'), 'utf8'));
if (!/^[0-9a-f]{64}$/.test(manifest.pdf_sha256)) fail('Malformed source PDF fingerprint');
const anchors = Object.values(manifest.entries).filter(entry =>
  Array.isArray(entry.anchorY)
).length;
if (anchors !== 1978) fail(`Equation anchors changed unexpectedly: ${anchors} (expected 1978)`);
const normalizedJS =
  '/* Equation location data only; no copyrighted source artwork. */\n' +
  'window.AtlasEquationManifest = ' +
  JSON.stringify(manifest) +
  ';\n';
if ((await readFile(join(app, 'equations', 'source-map.js'), 'utf8')) !== normalizedJS)
  fail('Generated equation manifest script is stale. Rebuild from source.');
const canonical = JSON.parse(
  await readFile(join(project, 'src/client/equations/source-map.json'), 'utf8')
);
if (JSON.stringify(canonical) !== JSON.stringify(manifest))
  fail('Generated source map differs from source of truth');
const entries = Object.entries(manifest.entries);
if (entries.length < 1900) fail('Equation source index unexpectedly small');
for (const [label, e] of entries) {
  if (!label || !Number.isInteger(e.page) || e.page < 1 || e.page > 1107)
    fail(`Invalid page for ${label}`);
  if (Array.isArray(e.parts)) {
    for (const part of e.parts)
      if (!manifest.entries[part]) fail(`Missing composite equation part ${part}`);
    continue;
  }
  if (
    !Array.isArray(e.crop) ||
    e.crop.length !== 4 ||
    !e.crop.every(Number.isFinite) ||
    e.crop[2] <= e.crop[0] ||
    e.crop[3] <= e.crop[1]
  )
    fail(`Invalid crop for ${label}`);
  if (e.file || e.svg || e.data) fail(`Publisher artwork reference in ${label}`);
}
// Keep the reviewed figure data and its generated browser wrapper in sync.
const figureMapText = await readFile(join(source, 'figures/source-map.json'), 'utf8');
const figureMap = JSON.parse(figureMapText);
const figureGeometry = await import('../src/client/figures/reviewed-crops.js');
const figureRules = figureGeometry.default;
if (!figureRules.matchesDocument(figureMap, manifest.pdf_sha256, manifest.pdf_pages))
  fail('Figure coordinates do not match the supported source PDF');
if (Object.keys(figureMap.entries || {}).length === 0) fail('Figure source map is empty');
for (const label of Object.keys(figureMap.entries)) {
  if (!figureRules.findParts(figureMap, label)) fail(`Invalid figure coordinates for ${label}`);
}
if ((await readFile(join(app, 'figures/source-map.json'), 'utf8')) !== figureMapText)
  fail('Generated figure source map is stale. Rebuild from source.');
const figureScript =
  '/* Reviewed figure coordinates only; no source artwork. */\n' +
  'window.AtlasFigureManifest = ' +
  JSON.stringify(figureMap) +
  ';\n';
if ((await readFile(join(app, 'figures/source-map.js'), 'utf8')) !== figureScript)
  fail('Generated figure manifest script is stale. Rebuild from source.');
const figureRenderer = await readFile(join(source, 'figures/renderer.js'), 'utf8');
const figureCSS = await readFile(join(source, 'styles/21-figure-preview.css'), 'utf8');
if (
  /figure-crop-|openEditor|saveCrop|selectedCrop|ea_figure_crops|localStorage/.test(
    figureRenderer + figureCSS
  )
)
  fail('Removed figure crop editing functionality has returned');
// Tables use the same coordinate validator, with separate page parts so even
// long symbol tables remain navigable without a tall composite image.
const tableMapText = await readFile(join(source, 'tables/source-map.json'), 'utf8');
const tableMap = JSON.parse(tableMapText);
const sourceRegions = (await import('../src/client/pdf/source-regions.js')).default;
if (!sourceRegions.matchesDocument(tableMap, manifest.pdf_sha256, manifest.pdf_pages))
  fail('Table coordinates do not match the supported source PDF');
if (Object.keys(tableMap.entries || {}).length !== 52) fail('Table source coverage changed');
let tableParts = 0;
for (const label of Object.keys(tableMap.entries)) {
  const parts = sourceRegions.findParts(tableMap, label);
  if (!parts) fail(`Invalid table coordinates for ${label}`);
  tableParts += parts.length;
}
if (tableParts !== 81) fail('Table page-part coverage changed');
if ((await readFile(join(app, 'tables/source-map.json'), 'utf8')) !== tableMapText)
  fail('Generated table source map is stale. Rebuild from source.');
const tableScript =
  '/* Reviewed table coordinates only; no source artwork. */\n' +
  'window.AtlasTableManifest = ' +
  JSON.stringify(tableMap) +
  ';\n';
if ((await readFile(join(app, 'tables/source-map.js'), 'utf8')) !== tableScript)
  fail('Generated table manifest script is stale. Rebuild from source.');
const eqDir = await readdir(join(app, 'equations'));
if (eqDir.some(name => name.toLowerCase().endsWith('.svg')))
  fail('Bundled textbook SVG artwork remains');
// Core modules and image decoders are separate because the native launcher's
// module endpoint does not serve decoder subpaths. A complete offline build
// contains both groups; a first-run package contains the decoder group.
const pdfjsAssets = JSON.parse(await readFile(join(project, 'tools/pdfjs-assets.json'), 'utf8'));
async function assetGroupPresent(directory, names) {
  const present = await Promise.all(
    names.map(async name => {
      try {
        await access(join(app, directory, name));
        return true;
      } catch {
        return false;
      }
    })
  );
  if (present.some(Boolean) && !present.every(Boolean))
    fail(`Incomplete PDF.js assets in ${directory}`);
  return present.every(Boolean);
}
const hasPDFJS = await assetGroupPresent('vendor/pdfjs', pdfjsAssets.modules);
const hasCodecs = await assetGroupPresent('vendor/pdfjs-codecs', pdfjsAssets.codecs);
if (hasPDFJS && !hasCodecs)
  fail('PDF.js modules are missing the CCITT/JBIG2 decoder. Run npm run build.');
if (!hasPDFJS) {
  await access(join(project, 'src/launcher/renderer.go'));
  await access(join(project, 'licenses/PDFJS-Apache-2.0.txt'));
}
const pdfjsStatus = hasPDFJS
  ? 'bundled with CCITT/JBIG2 decoder for offline use'
  : hasCodecs
    ? 'decoder bundled; core modules installable on first launch'
    : 'source checkout; npm run build is required for complete figure previews';
const oldFiles = (await readdir(app)).filter(f =>
  /^(?:workspace|polish-v|scientific-v|calculators-v|panel-min-widths|navigation-inline)\b/.test(f)
);
if (oldFiles.length) fail(`Legacy generated runtime files remain: ${oldFiles.join(', ')}`);
console.log(
  `Static verification passed: ${count} JS files, ${entries.length} equation entries, PDF.js ${pdfjsStatus}, zero equation SVG assets.`
);
