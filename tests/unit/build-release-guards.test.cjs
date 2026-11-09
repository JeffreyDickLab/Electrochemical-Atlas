'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const read = filename => fs.readFileSync(path.join(ROOT, filename), 'utf8');
const pdfjsAssets = JSON.parse(read('tools/pdfjs-assets.json'));
const runtimeAssets = [
  ...pdfjsAssets.modules.map(name => `pdfjs/${name}`),
  ...pdfjsAssets.codecs.map(name => `pdfjs-codecs/${name}`)
];

test('source-only rebuild preserves an existing offline PDF.js renderer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-build-guard-'));
  try {
    fs.cpSync(path.join(ROOT, 'src/client'), path.join(root, 'src/client'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    for (const filename of ['build.mjs', 'build-config.mjs', 'pdfjs-assets.json']) {
      fs.copyFileSync(path.join(ROOT, 'tools', filename), path.join(root, 'tools', filename));
    }
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
    const vendor = path.join(root, 'app/vendor');
    fs.mkdirSync(vendor, { recursive: true });
    for (const filename of runtimeAssets) {
      fs.mkdirSync(path.dirname(path.join(vendor, filename)), { recursive: true });
      fs.writeFileSync(path.join(vendor, filename), `offline-test-${filename}`);
    }
    const result = spawnSync(process.execPath, ['tools/build.mjs', '--source-only'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    for (const filename of runtimeAssets) {
      assert.equal(
        fs.readFileSync(path.join(vendor, filename), 'utf8'),
        `offline-test-${filename}`,
        `${filename} should survive source-only rebuilds`
      );
    }
    assert.ok(
      fs.existsSync(path.join(root, 'app/equation-preview.js')),
      'the refreshed app still contains the maintained equation renderer'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('tagged release gates on both PDF.js and the responsive browser suite', () => {
  const release = read('.github/workflows/release.yml');
  const ci = read('.github/workflows/ci.yml');
  for (const workflow of [release, ci]) {
    assert.match(workflow, /python tests\/browser\/pdfjs_equation_smoke\.py/);
    assert.match(workflow, /npm run test:browser/);
  }
  const runner = read('tools/run_browser_tests.py');
  assert.match(runner, /ATLAS_BROWSER_TIMEOUT_SEC/);
  assert.match(runner, /subprocess\.TimeoutExpired/);
  assert.match(runner, /Browser test timed out:/);
});

function makeBuildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-codec-build-'));
  fs.cpSync(path.join(ROOT, 'src/client'), path.join(root, 'src/client'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  for (const name of ['build.mjs', 'build-config.mjs', 'pdfjs-assets.json'])
    fs.copyFileSync(path.join(ROOT, 'tools', name), path.join(root, 'tools', name));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'));
  return root;
}

function installFixtureAssets(root, excluded = null) {
  for (const filename of runtimeAssets) {
    if (filename === excluded) continue;
    const [kind, name] = filename.split('/');
    const source =
      kind === 'pdfjs-codecs' ? `wasm/${name}` : name === 'LICENSE' ? name : `build/${name}`;
    const target = path.join(root, 'node_modules/pdfjs-dist', source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `upstream-exact-bytes:${filename}\n`);
  }
}

test('offline build copies the required decoder and its notices without modifying them', () => {
  const root = makeBuildFixture();
  try {
    installFixtureAssets(root);
    const result = spawnSync(process.execPath, ['tools/build.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(result.status, 0, result.stderr);
    for (const filename of runtimeAssets) {
      assert.equal(
        fs.readFileSync(path.join(root, 'app/vendor', filename), 'utf8'),
        `upstream-exact-bytes:${filename}\n`
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('offline build rejects a missing image decoder before replacing a working application', () => {
  const root = makeBuildFixture();
  try {
    installFixtureAssets(root, 'pdfjs-codecs/jbig2.wasm');
    const previousApp = path.join(root, 'app/index.html');
    fs.mkdirSync(path.dirname(previousApp), { recursive: true });
    fs.writeFileSync(previousApp, 'working application');
    const result = spawnSync(process.execPath, ['tools/build.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing pdfjs-dist\/wasm\/jbig2\.wasm/);
    assert.equal(fs.readFileSync(previousApp, 'utf8'), 'working application');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
