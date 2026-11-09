"""Portable browser-test utilities (no textbook content or local paths)."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def launch_chromium(playwright):
    """Prefer an explicit Chromium path, then system Chromium, then Playwright's."""
    configured = os.environ.get("ATLAS_CHROME")
    if configured:
        executable = Path(configured)
        if not executable.is_file():
            raise FileNotFoundError(f"ATLAS_CHROME does not exist: {executable}")
        browser_path = str(executable)
    else:
        system_browser = Path("/usr/bin/chromium")
        browser_path = str(system_browser) if system_browser.is_file() else None
    return playwright.chromium.launch(
        headless=True,
        executable_path=browser_path,
        args=["--no-sandbox"],
    )


def screenshot_path(filename: str) -> str:
    """Place optional screenshots outside tracked source using a portable path."""
    if Path(filename).name != filename or filename in ("", ".", ".."):
        raise ValueError("Browser screenshot names must be simple filenames")
    output = Path(os.environ.get("ATLAS_BROWSER_ARTIFACTS", str(ROOT / "tests/browser/_artifacts")))
    output.mkdir(parents=True, exist_ok=True)
    return str(output / filename)
