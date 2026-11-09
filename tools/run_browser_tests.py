#!/usr/bin/env python3
"""Run hermetic, synthetic browser regressions without the licensed textbook.

Requires `pip install playwright` and `python -m playwright install chromium`.
Use ATLAS_CHROME to choose a system browser and ATLAS_BROWSER_ARTIFACTS to
choose the optional screenshot directory. The app is never served remotely.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROWSER_DIR = ROOT / "tests" / "browser"
TESTS = (
    "home_menu_responsive.py",
    "unified_navigator.py",
    "menu_list_shared_sidebar.py",
    "sidebar-theme.py",
    "sidebar-recents-layout.py",
    "pdf-overlay-clearance.py",
    "pdf-navigation-no-toast.py",
    "symbol-tabs-responsive.py",
    "symbol-table-responsive.py",
    "science-typography.py",
    "figure-preview-smoke.py",
    "figure-preview-coverage.py",
    "figure-reviewed-crops.py",
)


def main() -> int:
    try:
        import playwright  # noqa: F401; give a useful error before starting
    except ImportError:
        print("Playwright is not installed. Run: python -m pip install playwright", file=sys.stderr)
        return 2

    # Bound a hung browser regression to one named script. The time limit is
    # per script (not the full suite), and can be increased by CI maintainers.
    try:
        timeout = int(os.environ.get("ATLAS_BROWSER_TIMEOUT_SEC", "180"))
    except ValueError:
        print("ATLAS_BROWSER_TIMEOUT_SEC must be an integer", file=sys.stderr)
        return 2
    if not 10 <= timeout <= 3600:
        print("ATLAS_BROWSER_TIMEOUT_SEC must be between 10 and 3600", file=sys.stderr)
        return 2

    for name in TESTS:
        test = BROWSER_DIR / name
        print(f"\n[Browser] {name}", flush=True)
        try:
            completed = subprocess.run([sys.executable, str(test)], cwd=ROOT,
                                       check=False, timeout=timeout)
        except subprocess.TimeoutExpired:
            print(f"Browser test timed out: {name} after {timeout}s", file=sys.stderr)
            return 124
        if completed.returncode:
            print(f"Browser test failed: {name} (exit {completed.returncode})", file=sys.stderr)
            return completed.returncode
    print(f"\n{len(TESTS)} synthetic browser scripts passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
