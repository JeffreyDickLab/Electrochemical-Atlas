#!/usr/bin/env python3
"""Build a verified, reproducible Electrochemical Atlas ZIP.

Only explicitly allowed project paths are packaged. PDF documents, generated
formula images, personal files, caches and development dependencies are excluded.
Source archives exclude compiled launchers. Portable archives include native
launchers and the image decoder and bootstrap PDF.js core modules on first
launch. Offline archives bundle the complete PDF.js distribution and can
include only the launchers for a single operating system.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from stat import S_IFREG
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
PDFJS_ASSETS = json.loads((ROOT / 'tools/pdfjs-assets.json').read_text())
PDFJS_MODULES = {f'app/vendor/pdfjs/{name}' for name in PDFJS_ASSETS['modules']}
PDFJS_CODECS = {f'app/vendor/pdfjs-codecs/{name}' for name in PDFJS_ASSETS['codecs']}
DIRECTORIES = ('.github', 'app', 'docs', 'licenses', 'runtime', 'src', 'tests', 'tools')
ROOT_FILES = (
    '.gitattributes', '.gitignore', 'COPYRIGHT_HOLDERS.md', 'LICENSE',
    'README_WINDOWS.txt',
    'Launch_Electrochemical_Atlas.bat', 'Launch_Electrochemical_Atlas.command',
    'Launch_Electrochemical_Atlas.sh', 'NOTICE.txt', 'README.md',
    'START_HERE.html', 'THIRD_PARTY_NOTICES.md', 'go.mod', 'package.json',
    'package-lock.json', 'prettier.config.mjs',
)
LEGAL_FILES = ('LICENSE', 'NOTICE.txt', 'COPYRIGHT_HOLDERS.md', 'THIRD_PARTY_NOTICES.md')
PLATFORM_FILES = {
    'windows': (
        'Launch_Electrochemical_Atlas.bat', 'README_WINDOWS.txt', 'runtime/atlas-windows-amd64.exe',
    ),
    'macos': (
        'Launch_Electrochemical_Atlas.command', 'runtime/atlas-darwin-amd64', 'runtime/atlas-darwin-arm64',
    ),
    'linux': (
        'Launch_Electrochemical_Atlas.sh', 'runtime/atlas-linux-amd64', 'runtime/atlas-linux-arm64',
    ),
}
PLATFORM_LABELS = {'windows': 'Windows', 'macos': 'macOS', 'linux': 'Linux'}
RUNTIMES = {name for files in PLATFORM_FILES.values() for name in files if name.startswith('runtime/')}
EXCLUDE_NAMES = {'.DS_Store', 'Thumbs.db', 'node_modules', '__pycache__', '.pytest_cache', '.git'}
EXCLUDE_SUFFIXES = {'.pdf', '.zip', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.pyc', '.log', '.tmp', '.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx'}
# Keep individual releases within GitHub's 100 MB per-file limit.
MAX_FILE_BYTES = 80 * 1024 * 1024
ARCHIVE_DATE = (2026, 11, 2, 0, 0, 0)


def files_for(mode: str, *, platform: str | None = None) -> list[tuple[Path, Path]]:
    if platform is not None or mode == 'windows':
        candidates = [ROOT / name for name in (*LEGAL_FILES, *PLATFORM_FILES[platform or 'windows'])]
        if platform is not None:
            candidates.append(ROOT / 'START_HERE.html')
        candidates += [child for dirname in ('app', 'licenses')
                       for child in (ROOT / dirname).rglob('*')]
    else:
        candidates = [ROOT / name for name in ROOT_FILES]
        selected_directories = [d for d in DIRECTORIES if mode != 'source' or d != 'runtime']
        candidates += [child for dirname in selected_directories for child in (ROOT / dirname).rglob('*')]
    selected: list[tuple[Path, Path]] = []
    for file in sorted(candidates):
        relative = file.relative_to(ROOT)
        if file.is_symlink():
            raise ValueError(f'Symlinks cannot be packaged: {relative}')
        if not file.is_file():
            continue
        if any(part in EXCLUDE_NAMES or part.startswith('.env') for part in relative.parts):
            continue
        if file.name.startswith('.') and file.name not in {'.gitignore', '.gitattributes'}:
            continue
        if file.suffix.lower() in EXCLUDE_SUFFIXES:
            continue
        if 'vendor' in relative.parts:
            if mode == 'source':
                continue
            # First-run packages bundle the image decoder. Existing native
            # launchers can install only the two PDF.js program modules.
            if mode == 'portable' and relative.parts[:3] == ('app', 'vendor', 'pdfjs'):
                continue
        if file.stat().st_size > MAX_FILE_BYTES:
            raise ValueError(f'Oversized project file: {relative}')
        selected.append((file, relative))
    return selected


def validate(mode: str, entries: set[str], *, platform: str | None = None) -> None:
    required = set(LEGAL_FILES) | {
        'app/index.html', 'app/app.js', 'app/atlas.css', 'app/equation-preview.js',
        'app/figure-geometry.js', 'app/figure-preview.js', 'app/figure-reviewed-crops.js',
        'app/figures/source-map.js', 'app/figures/source-map.json',
        'app/equations/source-map.js', 'app/equations/source-map.json',
        'app/source-regions.js', 'app/table-preview.js',
        'app/tables/source-map.js', 'app/tables/source-map.json',
    }
    if platform is not None or mode == 'windows':
        target = platform or 'windows'
        required.update(PLATFORM_FILES[target])
        if platform is not None:
            required.update({'START_HERE.html', 'licenses/PDFJS-Apache-2.0.txt'})
        other_launchers = {
            name for key, files in PLATFORM_FILES.items() if key != target
            for name in files if name.startswith('Launch_')
        }
        unexpected = {name for name in entries if name.startswith('runtime/')} - required
        unexpected.update(entries & other_launchers)
        if unexpected:
            raise ValueError(f'Unexpected {target} ZIP files: {sorted(unexpected)}')
    else:
        required.update({
            'README.md', 'README_WINDOWS.txt',
            'package.json', 'package-lock.json', 'prettier.config.mjs', 'tools/format.mjs',
            'tools/pdfjs-assets.json',
            'src/client/equations/source-map.json', 'src/client/equations/renderer.js',
            'src/client/figures/geometry.js', 'src/client/figures/renderer.js',
            'src/client/figures/reviewed-crops.js', 'src/client/figures/source-map.json',
            'src/client/pdf/source-regions.js', 'src/client/tables/renderer.js',
            'src/client/tables/source-map.json',
            'src/launcher/main.go', 'src/launcher/renderer.go',
            '.github/workflows/ci.yml', '.github/workflows/release.yml',
        })
        if mode in ('portable', 'offline'):
            required.update(RUNTIMES)
        elif entries & RUNTIMES:
            raise ValueError('GitHub source archives must not contain compiled executables')
    missing = required - entries
    if missing:
        raise ValueError(f'Missing required files: {sorted(missing)}')
    modules_present = entries & PDFJS_MODULES
    codecs_present = entries & PDFJS_CODECS
    if modules_present and modules_present != PDFJS_MODULES:
        raise ValueError('Incomplete PDF.js display/worker/license bundle')
    if codecs_present and codecs_present != PDFJS_CODECS:
        raise ValueError('Incomplete CCITT/JBIG2 decoder/license bundle')
    if mode == 'offline' and modules_present != PDFJS_MODULES:
        raise ValueError('Offline release requires both PDF.js modules and their license')
    if mode in ('offline', 'windows', 'portable') and codecs_present != PDFJS_CODECS:
        raise ValueError('Runnable releases require the CCITT/JBIG2 decoder. Run npm run build first.')
    if mode in ('source', 'portable') and modules_present:
        raise ValueError('Source/first-run package must not contain PDF.js program modules')
    if mode == 'source' and codecs_present:
        raise ValueError('Source package must not contain generated decoder binaries')
    if any(any('/' + kind + '/' in name for kind in ('equations', 'figures', 'tables')) and name.endswith(('.png', '.svg', '.pdf', '.jpg', '.jpeg', '.webp')) for name in entries):
        raise ValueError('Extracted textbook imagery must not be distributed')
    if len(entries) != len(set(entries)) or len(entries) < 25:
        raise ValueError('Duplicate archive entries or suspiciously small package')


def package(mode: str, destination: Path, *, platform: str | None = None) -> None:
    files = files_for(mode, platform=platform)
    names = {relative.as_posix() for _, relative in files}
    validate(mode, names, platform=platform)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED, compresslevel=7, allowZip64=True) as output:
        for file, relative in files:
            archive_path = f'Electrochemical-Atlas/{relative.as_posix()}'
            record = ZipInfo(archive_path, date_time=ARCHIVE_DATE)
            record.compress_type = ZIP_DEFLATED
            record.create_system = 3  # Unix metadata, even on a Windows build host.
            executable = (relative.suffix in {'.sh', '.command'} or
                          (relative.parts[0] == 'runtime' and relative.suffix != '.exe'))
            record.external_attr = (S_IFREG | (0o755 if executable else 0o644)) << 16
            output.writestr(record, file.read_bytes(), compress_type=ZIP_DEFLATED,
                            compresslevel=7)
    with ZipFile(destination) as archive:
        corrupted = archive.testzip()
        if corrupted:
            raise ValueError(f'Corrupt ZIP member: {corrupted}')
        if len(archive.namelist()) != len(files):
            raise ValueError('Archive member count mismatch')
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    label = PLATFORM_LABELS[platform] if platform is not None else mode
    print(f'Atlas {label} ZIP: {len(files)} files, {destination.stat().st_size / 1024**2:.2f} MiB')
    print(f'SHA-256: {digest}')
    print(f'Output: {destination}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('source', 'portable', 'offline', 'windows'), default='source')
    parser.add_argument('--platform', choices=PLATFORM_FILES, help='limit an offline ZIP to one operating system')
    parser.add_argument('output', type=Path, nargs='?')
    args = parser.parse_args()
    if args.platform is not None and args.mode != 'offline':
        parser.error('--platform requires --mode offline')
    default_name = {
        'source': 'Electrochemical_Atlas_GitHub_Source.zip',
        'portable': 'Electrochemical_Atlas_First_Run_Portable.zip',
        'offline': 'Electrochemical_Atlas_Offline_Release.zip',
        'windows': 'Electrochemical_Atlas_Windows_Portable.zip',
    }[args.mode]
    if args.platform is not None:
        default_name = f'Electrochemical_Atlas_{PLATFORM_LABELS[args.platform]}_Offline.zip'
    package(args.mode, args.output or ROOT.parent / default_name, platform=args.platform)


if __name__ == '__main__':
    main()
