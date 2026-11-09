# Publishing Electrochemical Atlas to GitHub

This document is for the repository maintainer. It does not require sharing a GitHub password or repository token.

## 1. Review the source package

Use the output from `npm run package:source` (or the supplied **GitHub Repository Source** ZIP). Extract it. The **contents of `Electrochemical-Atlas/`**, not the ZIP itself, should become the repository root. The `runtime/` directory and compiled `atlas-*` binaries are intentionally excluded from the source archive and are distributed as separate release assets. Confirm the folder contains `README.md`, `LICENSE`, `NOTICE.txt`, `.gitignore`, `.github/`, `src/`, `app/`, `tests/`, and `tools/`.

Do **not** upload the textbook PDF, extracted pages, private notes, PDF file paths or personal configuration folders. If you modify files after extraction, run the source-only verification commands in `docs/RELEASE_VALIDATION.md` before committing.

## 2. Create the repository

On GitHub, choose **New repository**, enter `Electrochemical-Atlas` (or another name you control), choose the visibility, and create an **empty repository**. Do not have GitHub generate another README or license, since the project already includes those files.

From a terminal opened inside the extracted `Electrochemical-Atlas/` folder:

```sh
git init -b main
git add .
git status
git commit -m "Prepare Electrochemical Atlas source release"
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Replace `YOUR_ACCOUNT` and `YOUR_REPOSITORY` with the actual values on GitHub; do not share authentication secrets in this project. GitHub Desktop can also create a repository from this folder if you prefer a graphical interface.

With an authenticated GitHub CLI, you can create a private repository and push the first commit in one command. Run this in place of the last two commands if you have yet to create the repository.

```sh
gh repo create Electrochemical-Atlas --private --source . --remote origin --push
```

## 3. Publish an offline release

**Important:** The repository source ZIP includes the Windows `.bat` launcher as source, but intentionally excludes `runtime/atlas-windows-amd64.exe`. It is *not* a runnable Windows download. Direct Windows users to a portable or offline **Release asset**, which includes that executable.

GitHub Actions builds an offline release when you push a version tag that matches `package.json`. The Go launcher's version and the npm lockfile must match as well. After reviewing the commit and completing the release checks, push the tag. The current version is `6.30`.

```sh
git tag -a v6.30 -m "Electrochemical Atlas v6.30"
git push origin refs/tags/v6.30
```

The three jobs build and test independently. The first successful job creates the release for the tag, and each successful job uploads its own ZIP as soon as it finishes.

| Release asset | Launchers |
| --- | --- |
| `Electrochemical_Atlas_Windows.zip` | Windows x64 |
| `Electrochemical_Atlas_macOS.zip` | macOS Intel and Apple Silicon |
| `Electrochemical_Atlas_Linux.zip` | Linux x64 and ARM64 |

If a platform fails, its job is marked failed while the others can still publish. Use **Actions → Re-run failed jobs** to retry the missing asset. Uploaded assets stay available during a retry.

Independent uploads to one published release require a repository that allows release assets to be added after publication. GitHub's immutable releases lock assets when published. [GitHub documentation on immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)

Each archive includes the PDF.js renderer and decoder for offline use. The workflow cross-compiles the launchers on Ubuntu. Check the Actions output and smoke-test each download on its native operating system before announcing the release.

The repository source ZIP is **not a ready-to-run portable release**: contributors need Go to build a launcher or can download a release asset. A first-run portable ZIP includes native launchers and may need internet once for PDF.js. A fully offline ZIP includes both the native launchers and the upstream PDF.js modules/license. Use the release workflow for the last option.

## 4. Maintenance

Keep author credits restricted to **Azaria A. Wagner and Jeffrey E. Dick** in Atlas-authored notices. Preserve upstream license notices for dependencies and bibliographic identification of the textbook. Do not remove third-party attribution in an attempt to change project authorship.
