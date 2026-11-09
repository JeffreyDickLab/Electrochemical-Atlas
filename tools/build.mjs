/**
 * Reproducible, dependency-free client build.
 * Source lives under src/client; app/ is the portable runtime output.
 * Only source-page coordinates live in app/equations. Third-party PDF.js
 * modules are copied from the pinned npm dependency for fully offline use.
 */
import { readFile, writeFile, copyFile, readdir, mkdir, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserModules, applicationParts } from './build-config.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(projectRoot, 'src/client');
const outputRoot = join(projectRoot, 'app');
const pkg = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const sourceOnly = process.argv.includes('--source-only');
const pdfjsAssets = JSON.parse(
  await readFile(join(projectRoot, 'tools/pdfjs-assets.json'), 'utf8')
);
const pdfjsCopies = [
  ...pdfjsAssets.modules.map(name => ({
    source: name === 'LICENSE' ? name : `build/${name}`,
    destination: `vendor/pdfjs/${name}`
  })),
  ...pdfjsAssets.codecs.map(name => ({
    source: `wasm/${name}`,
    destination: `vendor/pdfjs-codecs/${name}`
  }))
];
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--source-only')) {
  throw new Error('Usage: node tools/build.mjs [--source-only]');
}

async function buildSourceMap(directory, globalName, notice) {
  const text = await readFile(join(sourceRoot, directory, 'source-map.json'), 'utf8');
  const manifest = JSON.parse(text);
  const destination = join(outputRoot, directory);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'source-map.json'), text, 'utf8');
  await writeFile(
    join(destination, 'source-map.js'),
    `/* ${notice} */\nwindow.${globalName} = ${JSON.stringify(manifest)};\n`,
    'utf8'
  );
}

async function main() {
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Version must be major.minor');
  // Reject incomplete dependency installs before modifying a working app/.
  if (!sourceOnly) {
    for (const { source: name } of pdfjsCopies) {
      try {
        await readFile(join(projectRoot, 'node_modules', 'pdfjs-dist', name));
      } catch {
        throw new Error(`Missing pdfjs-dist/${name}. Run npm ci before npm run build.`);
      }
    }
  }

  await mkdir(outputRoot, { recursive: true });
  await mkdir(join(outputRoot, 'equations'), { recursive: true });

  // Remove obsolete runtime scripts and styles; preserve only canonical
  // files, generated outputs and source-position metadata.
  const existing = await readdir(outputRoot);
  for (const name of existing) {
    if (name === 'equations') continue;
    // Source-only rebuilds are also used by people maintaining an installed
    // portable app. Preserve their already-installed PDF.js engine instead of
    // silently disabling equation previews. Source ZIPs exclude vendor/ at
    // packaging time, so this does not add third-party files to the repo.
    if (name === 'vendor') {
      if (!sourceOnly) await rm(join(outputRoot, name), { recursive: true, force: true });
      continue;
    }
    if (name.endsWith('.js') || name.endsWith('.css') || name === 'index.html') {
      await rm(join(outputRoot, name), { force: true });
    }
  }

  // All preview indexes contain source geometry, never copied PDF artwork.
  await buildSourceMap(
    'equations',
    'AtlasEquationManifest',
    'Equation location data only; no copyrighted source artwork.'
  );
  await buildSourceMap(
    'figures',
    'AtlasFigureManifest',
    'Reviewed figure coordinates only; no source artwork.'
  );
  await buildSourceMap(
    'tables',
    'AtlasTableManifest',
    'Reviewed table coordinates only; no source artwork.'
  );

  for (const [filename, rel] of Object.entries(browserModules)) {
    await copyFile(join(sourceRoot, rel), join(outputRoot, filename));
  }
  const chunks = await Promise.all(
    applicationParts.map(name => readFile(join(sourceRoot, 'application', name), 'utf8'))
  );
  // The existing application shares closure-local state. Build concatenation
  // retains function hoisting and load order as a safe transitional boundary.
  await writeFile(
    join(outputRoot, 'app.js'),
    chunks
      .map((text, i) => `/* src/client/application/${applicationParts[i]} */\n${text}`)
      .join('\n'),
    'utf8'
  );

  const cssNames = (await readdir(join(sourceRoot, 'styles')))
    .filter(f => f.endsWith('.css'))
    .sort();
  const cssParts = await Promise.all(
    cssNames.map(name => readFile(join(sourceRoot, 'styles', name), 'utf8'))
  );
  const css = cssParts.map((css, i) => `/* ${cssNames[i]} */\n${css.trimEnd()}\n`).join('\n');
  await writeFile(join(outputRoot, 'atlas.css'), css, 'utf8');

  const html = await readFile(join(sourceRoot, 'index.html'), 'utf8');
  await writeFile(join(outputRoot, 'index.html'), html, 'utf8');

  // PDF.js 6 also needs a decoder for CCITT/JBIG2 images in the source book.
  // Its separate static directory works with existing native launchers, whose
  // /vendor/pdfjs/ endpoint allows only the display and worker modules.
  if (!sourceOnly) {
    for (const asset of pdfjsCopies) {
      const destination = join(outputRoot, asset.destination);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(projectRoot, 'node_modules/pdfjs-dist', asset.source), destination);
    }
  }

  const scriptRefs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]);
  for (const ref of scriptRefs) {
    try {
      await readFile(join(outputRoot, ref));
    } catch {
      throw new Error(`Missing runtime script: ${ref}`);
    }
  }
  console.log(
    `Atlas v${version} (${sourceOnly ? 'source-only' : 'offline'}): ${Object.keys(browserModules).length + 1} JS files, 1 CSS file (${cssNames.length} modules), ${scriptRefs.length} startup scripts`
  );
}
await main();
