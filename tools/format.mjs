/**
 * Format maintained browser source without breaking the shared application.
 *
 * Application files are consecutive fragments of one closure. Parse and format
 * the complete closure, then split at stable comment markers. Ordinary modules,
 * styles and HTML are independent files. Generated app/, third-party code and
 * coordinate JSON are deliberately outside this command.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import prettier from 'prettier';
import config from '../prettier.config.mjs';
import { applicationParts } from './build-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'src/client');
const application = join(client, 'application');
const markerPrefix = '/* ATLAS_APPLICATION_PART: ';
const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
const changes = [];
let checked = 0;

async function compareAndWrite(file, original, formatted) {
  checked += 1;
  if (original === formatted) return;
  changes.push(relative(root, file));
  if (!values.check) await writeFile(file, formatted, 'utf8');
}

function marker(name) {
  return `${markerPrefix}${name} */`;
}

async function formatApplication() {
  const files = await Promise.all(
    applicationParts.map(name => readFile(join(application, name), 'utf8'))
  );
  for (const [index, content] of files.entries()) {
    if (content.includes(markerPrefix))
      throw new Error(`Reserved formatter marker in ${applicationParts[index]}`);
  }
  const joined = files
    .map((content, index) => `${marker(applicationParts[index])}\n${content}`)
    .join('\n');
  const formatted = await prettier.format(joined, { ...config, parser: 'babel' });
  const boundaries = applicationParts.map(name => formatted.indexOf(marker(name)));
  if (
    boundaries.some(
      (position, index) => position < 0 || (index && position <= boundaries[index - 1])
    )
  ) {
    throw new Error(
      'Application part markers changed during formatting; no fragments were written.'
    );
  }
  for (let index = 0; index < applicationParts.length; index += 1) {
    const afterMarker = boundaries[index] + marker(applicationParts[index]).length;
    const nextMarker =
      index + 1 < applicationParts.length ? boundaries[index + 1] : formatted.length;
    // Only boundary blank lines are normalized. Keep indentation inside the
    // closure, including the leading spaces before each function declaration.
    const fragment =
      formatted
        .slice(afterMarker, nextMarker)
        .replace(/^\s*\n/, '')
        .trimEnd() + '\n';
    await compareAndWrite(join(application, applicationParts[index]), files[index], fragment);
  }
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = join(directory, entry.name);
    if (file === application) continue;
    if (entry.isDirectory()) files.push(...(await sourceFiles(file)));
    else if (/\.(?:js|mjs|cjs|css|html)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function main() {
  await formatApplication();
  const files = [
    ...(await sourceFiles(client)),
    ...(await sourceFiles(join(root, 'tools'))),
    ...(await sourceFiles(join(root, 'tests/unit'))),
    join(root, 'START_HERE.html'),
    join(root, 'prettier.config.mjs')
  ];
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const formatted = await prettier.format(original, { ...config, filepath: file });
    await compareAndWrite(file, original, formatted);
  }
  if (values.check && changes.length) {
    console.error(`Formatting needed in ${changes.length} files:\n${changes.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(
      `${values.check ? 'Checked' : 'Formatted'} ${checked} maintained files; ${changes.length} changed.`
    );
  }
}

await main();
