'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('GitHub source uses one maintainable browser-test runner and portable artifacts', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:browser'], 'python3 tools/run_browser_tests.py');
  const runner = read('tools/run_browser_tests.py');
  assert.match(runner, /menu_list_shared_sidebar\.py/);
  assert.match(runner, /symbol-table-responsive\.py/);
  const helper = read('tests/browser/_support.py');
  assert.match(helper, /ATLAS_CHROME/);
  assert.match(helper, /ATLAS_BROWSER_ARTIFACTS/);
  assert.match(read('.gitignore'), /tests\/browser\/_artifacts\//);
  for (const filename of fs.readdirSync(path.join(root, 'tests/browser'))) {
    if (!filename.endsWith('.py')) continue;
    const source = read(`tests/browser/${filename}`);
    assert.doesNotMatch(
      source,
      /\/mnt\/data\//,
      `${filename} contains a machine-specific screenshot path`
    );
    assert.doesNotMatch(
      source,
      /executable_path=['"]\/usr\/bin\/chromium['"]/,
      `${filename} forces an OS-specific browser path`
    );
  }
});

test('source and portable release instructions match the actual package modes', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.deepEqual(pkg.contributors, ['Azaria A. Wagner', 'Jeffrey E. Dick']);
  const publishing = read('docs/GITHUB_PUBLISHING.md');
  assert.match(publishing, /runtime\/.*excluded/);
  assert.match(publishing, /npm run package:source/);
  assert.match(read('docs/RELEASE_VALIDATION.md'), /npm run test:browser/);
  assert.match(read('docs/CHANGELOG.md'), /^# Changelog/m);
  assert.doesNotMatch(read('src/client/styles/18-toolbar.css'), /atlas-list-toggle/);
});
