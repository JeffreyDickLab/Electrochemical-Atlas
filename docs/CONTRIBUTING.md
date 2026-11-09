# Contributing

Please keep changes small, traceable and testable. Electrochemical Atlas is deliberately local-first and uses a user-supplied book PDF rather than distributing copied publisher content.

1. Reproduce the issue with a unit test or a locally held PDF/browser test.
2. Edit maintained files under `src/client/` or `src/launcher/`. Do not hand-edit generated `app/` artifacts or native `runtime/` binaries.
3. Run `npm run format` when npm development dependencies are installed, then `npm run build:source` (or `npm run build` when npm dependencies are installed), `npm run check`, `npm test` and `go test ./src/launcher`.
4. Check that search, bookmarks, reading modes, narrow-screen navigation and original-PDF opening still work. Do not alter saved state keys without migration tests.
5. Do not edit equation source coordinates casually. Preserve all anchors and review any change against the matching original PDF and the [Equation audit](EQUATION_AUDIT.md).
6. Escape all user-/PDF-derived HTML, preserve the localhost origin checks, and avoid telemetry or runtime external UI dependencies.
7. For changes affecting publication, update [Release validation](RELEASE_VALIDATION.md) and the changelog.

## Readable, reproducible source

Run `npm ci --ignore-scripts --omit=optional` to install the exact dependencies
from `package-lock.json`. `npm run format` applies the pinned Prettier version
and `prettier.config.mjs`; `npm run format:check` is the read-only check.

The files in `src/client/application/` share a single closure. Do not format or
parse them as independent programs. `tools/format.mjs` assembles them with
stable markers, formats the complete program, and restores the same file
boundaries. The build uses the same ordered part list. Other browser modules,
stylesheets, HTML, JavaScript build tools and unit tests are formatted directly.
Generated `app/`, dependencies, coordinate JSON and embedded scientific strings
are excluded from formatting.

Keep each change within its existing module unless a concrete dependency makes
that impossible. Use explicit names for new state and functions. Document the
reason for unusual code, rather than repeating what each statement does.
Changes to whitespace should not require changes to behavior assertions; static
source checks should tolerate insignificant whitespace.

See [Figure previews](FIGURE_PREVIEWS.md) before changing reviewed boundaries.
A crop change needs visual comparison with the source PDF in addition to tests.

## Project authorship and submissions

The credited project authors are **Azaria A. Wagner and Jeffrey E. Dick**. Contributions must be submitted by people entitled to license their work on the applicable terms; contributing does not transfer copyright or remove the rights of a contributor or any third party. Project author attribution does not override mandatory notices for independently licensed dependencies.

Do not include the publisher PDF, source-page screenshots, extracted equation artwork, private notes, or machine-specific file paths in commits or issue attachments.
