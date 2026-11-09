/** Build, verify and package the launchers for a platform or the full offline bundle. */
import { spawnSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platforms = {
  windows: { label: 'Windows', os: 'windows', architectures: ['amd64'] },
  macos: { label: 'macOS', os: 'darwin', architectures: ['amd64', 'arm64'] },
  linux: { label: 'Linux', os: 'linux', architectures: ['amd64', 'arm64'] }
};
const {
  values: { platform }
} = parseArgs({ options: { platform: { type: 'string' } } });
if (platform !== undefined && !Object.hasOwn(platforms, platform))
  throw new Error('Expected --platform windows, macos, or linux');

const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const tag = process.env.GITHUB_REF_TYPE === 'branch' ? undefined : process.env.GITHUB_REF_NAME;
if (tag && tag !== `v${version}`)
  throw new Error(`Git tag ${tag} does not match package version v${version}`);

function run(cmd, args, env = {}) {
  console.log('$', cmd, ...args);
  const done = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  if (done.error) throw done.error;
  if (done.status !== 0) throw new Error(`${cmd} failed (${done.status ?? done.signal})`);
}

const npm = process.env.npm_execpath;
const python = process.platform === 'win32' ? 'python' : 'python3';
if (npm) run(process.execPath, [npm, 'run', 'test:all']);
else run('npm', ['run', 'test:all']);
run('go', ['test', './src/launcher']);
run('go', ['vet', './src/launcher']);

await mkdir(join(root, 'runtime'), { recursive: true });
for (const name of platform ? [platform] : Object.keys(platforms)) {
  const { os, architectures } = platforms[name];
  const suffix = os === 'windows' ? '.exe' : '';
  for (const arch of architectures) {
    const filename = `atlas-${os}-${arch}${suffix}`;
    run(
      'go',
      [
        'build',
        '-trimpath',
        '-buildvcs=false',
        '-ldflags=-s -w',
        '-o',
        join(root, 'runtime', filename),
        './src/launcher'
      ],
      { GOOS: os, GOARCH: arch, CGO_ENABLED: '0' }
    );
  }
}

run(python, ['-m', 'unittest', 'discover', '-s', 'tests/integration', '-p', 'test_package.py']);
const defaultName = platform
  ? `Electrochemical_Atlas_${platforms[platform].label}.zip`
  : 'Electrochemical_Atlas_Portable.zip';
const out = resolve(root, process.env.ATLAS_RELEASE_ZIP || join('..', defaultName));
const packager = join(root, 'tools', 'package.py');
const platformArgs = platform ? ['--platform', platform] : [];
run(python, [packager, '--mode', 'offline', ...platformArgs, out]);
if (!platform) {
  const windowsOut = resolve(root, '..', 'Electrochemical_Atlas_Windows_Portable.zip');
  run(python, [packager, '--mode', 'windows', windowsOut]);
}
