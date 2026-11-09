"""Release archive checks independent of npm and the original textbook."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from stat import S_IMODE
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'tools' / 'package.py'
PDFJS_FILES = json.loads((ROOT / 'tools/pdfjs-assets.json').read_text())
DECODER_FILES = PDFJS_FILES['codecs']
PLATFORMS = {
    'windows': ('Launch_Electrochemical_Atlas.bat', {'runtime/atlas-windows-amd64.exe'}, b'MZ'),
    'macos': (
        'Launch_Electrochemical_Atlas.command',
        {'runtime/atlas-darwin-amd64', 'runtime/atlas-darwin-arm64'},
        bytes.fromhex('cffaedfe'),
    ),
    'linux': (
        'Launch_Electrochemical_Atlas.sh',
        {'runtime/atlas-linux-amd64', 'runtime/atlas-linux-arm64'},
        b'\x7fELF',
    ),
}
RUNTIMES = set().union(*(runtimes for _, runtimes, _ in PLATFORMS.values()))


def load_packager():
    spec = importlib.util.spec_from_file_location('atlas_packager', TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def manifest(packager, mode, *, platform=None):
    names = {relative.as_posix() for _, relative in packager.files_for(mode, platform=platform)}
    # Manifest tests run after the client build even when no native binaries
    # have been compiled. Archive tests below inspect the actual launchers.
    if platform or mode == 'windows':
        return names | PLATFORMS[platform or 'windows'][1]
    if mode in ('offline', 'portable'):
        return names | RUNTIMES
    return names


class PackagingTests(unittest.TestCase):
    def test_source_zip_is_reproducible_and_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output_a = Path(temp) / 'first.zip'
            output_b = Path(temp) / 'second.zip'
            for destination in (output_a, output_b):
                subprocess.run([sys.executable, str(TOOL), '--mode', 'source',
                                str(destination)], check=True, capture_output=True)
            sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(sha(output_a), sha(output_b))
            with ZipFile(output_a) as archive:
                self.assertIsNone(archive.testzip())
                names = archive.namelist()
                self.assertEqual(len(names), len(set(names)))
                self.assertTrue(all(name.startswith('Electrochemical-Atlas/') for name in names))
                self.assertFalse(any('/runtime/atlas-' in name for name in names))
                self.assertTrue(any(name.endswith('src/client/equations/renderer.js') for name in names))
                self.assertTrue(any(name.endswith('docs/GITHUB_PUBLISHING.md') for name in names))
                for file in ('package-lock.json', 'prettier.config.mjs', 'tools/format.mjs',
                             'src/client/pdf/source-regions.js', 'app/source-regions.js',
                             'src/client/tables/renderer.js', 'app/table-preview.js',
                             'src/client/tables/source-map.json', 'app/tables/source-map.js'):
                    self.assertIn('Electrochemical-Atlas/' + file, names)
                self.assertFalse(any(name.lower().endswith(('.pdf', '.png', '.jpg', '.svg')) for name in names))
                self.assertFalse(any('/vendor/' in name or '/node_modules/' in name for name in names))
                self.assertFalse(any(name.endswith(('README_FIRST.txt', 'SCIENTIFIC_VALIDATION.txt')) for name in names))
                for license_name in ('LICENSE', 'NOTICE.txt', 'COPYRIGHT_HOLDERS.md',
                                     'THIRD_PARTY_NOTICES.md'):
                    self.assertIn('Electrochemical-Atlas/' + license_name, names)
                attribution = archive.read('Electrochemical-Atlas/NOTICE.txt').decode()
                self.assertIn('Azaria A. Wagner and Jeffrey E. Dick', attribution)
                self.assertNotIn('current members', attribution)


    def test_package_rejects_symlinked_source_files(self) -> None:
        # Keep the test hermetic: validate against an injected symlink candidate
        # rather than modifying the actual project checkout.
        module = load_packager()
        with tempfile.TemporaryDirectory() as temp:
            original_root = module.ROOT
            test_root = Path(temp)
            (test_root / 'app').mkdir()
            (test_root / 'app' / 'sneaky.txt').symlink_to(Path(__file__).resolve())
            module.ROOT = test_root
            try:
                with self.assertRaisesRegex(ValueError, 'Symlinks cannot be packaged'):
                    module.files_for('source')
            finally:
                module.ROOT = original_root

    @unittest.skipUnless((ROOT / 'runtime' / 'atlas-windows-amd64.exe').exists(),
                         'Windows launcher is built for portable distributions')
    def test_windows_zip_has_complete_launch_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'windows.zip'
            subprocess.run([sys.executable, str(TOOL), '--mode', 'windows',
                            str(destination)], check=True, capture_output=True)
            with ZipFile(destination) as archive:
                self.assertIsNone(archive.testzip())
                names = set(archive.namelist())
                prefix = 'Electrochemical-Atlas/'
                for filename in ('Launch_Electrochemical_Atlas.bat', 'README_WINDOWS.txt',
                                 'runtime/atlas-windows-amd64.exe', 'app/index.html',
                                 'app/equation-preview.js', 'LICENSE'):
                    self.assertIn(prefix + filename, names)
                self.assertEqual(
                    [name for name in names if name.startswith(prefix + 'runtime/')],
                    [prefix + 'runtime/atlas-windows-amd64.exe'],
                )
                self.assertFalse(any(name.endswith('.pdf') for name in names))
                self.assertFalse(any('/src/' in name for name in names))
                for name in DECODER_FILES:
                    self.assertIn(prefix + 'app/vendor/pdfjs-codecs/' + name, names)
                archive.extractall(temp)
            folder = Path(temp) / 'Electrochemical-Atlas'
            self.assertTrue((folder / 'Launch_Electrochemical_Atlas.bat').is_file())
            self.assertTrue((folder / 'runtime' / 'atlas-windows-amd64.exe').is_file())
            self.assertTrue((folder / 'app' / 'index.html').is_file())
            exe = (folder / 'runtime' / 'atlas-windows-amd64.exe').read_bytes()
            self.assertTrue(exe.startswith(b'MZ'), 'Windows executable must have PE header')

    def test_runnable_archives_reject_incomplete_decoders_or_notices(self) -> None:
        module = load_packager()
        modes = [(mode, None) for mode in ('offline', 'windows', 'portable')]
        modes += [('offline', platform) for platform in PLATFORMS]
        for mode, platform in modes:
            entries = manifest(module, mode, platform=platform)
            module.validate(mode, entries, platform=platform)
            for name in ('jbig2.wasm', 'LICENSE_JBIG2'):
                with self.subTest(mode=mode, platform=platform, missing=name):
                    incomplete = entries - {'app/vendor/pdfjs-codecs/' + name}
                    with self.assertRaisesRegex(ValueError, 'decoder'):
                        module.validate(mode, incomplete, platform=platform)

    def test_platform_archives_reject_missing_pdfjs_and_foreign_launchers(self) -> None:
        module = load_packager()
        modules = {'app/vendor/pdfjs/' + name for name in PDFJS_FILES['modules']}
        for platform, (_, runtimes, _) in PLATFORMS.items():
            entries = manifest(module, 'offline', platform=platform)
            other_launcher = next(launcher for key, (launcher, _, _) in PLATFORMS.items()
                                  if key != platform)
            with self.subTest(platform=platform):
                for missing in ({name} for name in modules):
                    with self.assertRaisesRegex(ValueError, 'PDF.js'):
                        module.validate('offline', entries - missing, platform=platform)
                with self.assertRaisesRegex(ValueError, 'PDF.js'):
                    module.validate('offline', entries - modules, platform=platform)
                for foreign in [other_launcher, *(RUNTIMES - runtimes)]:
                    with self.assertRaisesRegex(ValueError, 'Unexpected'):
                        module.validate('offline', entries | {foreign}, platform=platform)

    def test_platform_offline_zips_have_only_the_selected_launchers(self) -> None:
        prefix = 'Electrochemical-Atlas/'
        shared = {
            'START_HERE.html', 'LICENSE', 'NOTICE.txt', 'COPYRIGHT_HOLDERS.md',
            'THIRD_PARTY_NOTICES.md', 'licenses/PDFJS-Apache-2.0.txt', 'app/index.html',
            *('app/vendor/pdfjs/' + name for name in PDFJS_FILES['modules']),
            *('app/vendor/pdfjs-codecs/' + name for name in DECODER_FILES),
        }
        with tempfile.TemporaryDirectory() as temp:
            for platform, (launcher, runtimes, signature) in PLATFORMS.items():
                with self.subTest(platform=platform):
                    if not all((ROOT / name).is_file() for name in runtimes):
                        self.skipTest(f'{platform} launchers have not been built')
                    destination = Path(temp) / f'{platform}.zip'
                    subprocess.run([sys.executable, str(TOOL), '--mode', 'offline',
                                    '--platform', platform, str(destination)],
                                   check=True, capture_output=True)
                    with ZipFile(destination) as archive:
                        self.assertIsNone(archive.testzip())
                        paths = {name.removeprefix(prefix) for name in archive.namelist()}
                        selected = {name for name in paths if name.startswith(('runtime/', 'Launch_'))}
                        self.assertEqual(selected, {launcher, *runtimes})
                        self.assertLessEqual(shared, paths)
                        self.assertFalse(any(name.startswith(('src/', 'tools/', '.github/'))
                                             or name.lower().endswith('.pdf') for name in paths))
                        for name in selected:
                            info = archive.getinfo(prefix + name)
                            self.assertEqual(info.create_system, 3)
                            self.assertEqual(S_IMODE(info.external_attr >> 16),
                                             0o644 if platform == 'windows' else 0o755)
                        for runtime in runtimes:
                            with archive.open(prefix + runtime) as executable:
                                self.assertEqual(executable.read(len(signature)), signature)

    def test_windows_launcher_explains_source_zip_and_extract_all(self) -> None:
        launcher = (ROOT / 'Launch_Electrochemical_Atlas.bat').read_text()
        self.assertIn('runtime\\atlas-windows-amd64.exe', launcher)
        self.assertIn('Extract All', launcher)
        self.assertIn('GitHub source ZIP', launcher)
        self.assertIn('Protection history', launcher)
        self.assertIn('app\\index.html', launcher)

    def test_packages_require_table_preview_dependencies(self) -> None:
        module = load_packager()
        for mode in ('source', 'offline', 'windows', 'portable'):
            entries = manifest(module, mode)
            module.validate(mode, entries)
            for required in ('app/source-regions.js', 'app/table-preview.js',
                             'app/tables/source-map.js'):
                with self.subTest(mode=mode, missing=required):
                    with self.assertRaisesRegex(ValueError, 'Missing required files'):
                        module.validate(mode, entries - {required})

    @unittest.skipUnless(all((ROOT / 'runtime' / name).exists() for name in (
        'atlas-windows-amd64.exe', 'atlas-linux-amd64', 'atlas-linux-arm64',
        'atlas-darwin-amd64', 'atlas-darwin-arm64')),
        'portable binaries are built by npm run release, not committed to source')
    def test_portable_archive_includes_all_five_launchers_but_no_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / 'portable.zip'
            subprocess.run([sys.executable, str(TOOL), '--mode', 'portable',
                            str(destination)], check=True, capture_output=True)
            with ZipFile(destination) as archive:
                self.assertIsNone(archive.testzip())
                paths = set(archive.namelist())
                for executable in ('atlas-windows-amd64.exe', 'atlas-linux-amd64',
                                   'atlas-linux-arm64', 'atlas-darwin-amd64',
                                   'atlas-darwin-arm64'):
                    self.assertIn(f'Electrochemical-Atlas/runtime/{executable}', paths)
                self.assertFalse(any('/app/vendor/pdfjs/' in path for path in paths))
                for name in DECODER_FILES:
                    self.assertIn('Electrochemical-Atlas/app/vendor/pdfjs-codecs/' + name, paths)
                self.assertFalse(any(path.endswith('.pdf') for path in paths))


if __name__ == '__main__':
    unittest.main()
