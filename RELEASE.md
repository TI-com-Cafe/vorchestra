# Release Process

VOrchestra releases are built from Git tags through `.github/workflows/release.yml`.

## Current Version

`0.1.0`

## Release Requirements

Before tagging a release:

- `main` is green in CI.
- `CHANGELOG.md` has a dated release entry.
- Version is consistent in:
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
- README reflects install state and known limitations.
- Real app smoke test passed with `npm run tauri dev`.
- Dependabot PRs that may regress the app have been closed or deferred.

## Local Preflight

```bash
npm run check
npm run build
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test --all-targets
```

## Real App Smoke Test

Run:

```bash
npm run tauri dev
```

Minimum manual flow:

1. Add a workspace.
2. Scan workspace.
3. Create an environment with `pip`.
4. Create an environment with `uv` when available.
5. Create from a template.
6. Open Studio.
7. Load package list.
8. Open tree and graph views.
9. Run Diagnostics manually.
10. Run Security Scan manually.
11. Open Repair Wizard.
12. Open Disk Cleanup Mode.
13. Generate VS Code config.
14. Generate Docker files.
15. Confirm no UI freeze and no repeated `database is locked` errors.

## Tagging

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow creates a draft prerelease.

## Artifact Verification

Before publishing the GitHub Release:

- Linux AppImage starts.
- Linux `.deb` installs.
- macOS `.dmg` opens.
- Windows installer runs.
- App version displays as expected.
- The first-run wizard opens on a clean profile.
- Workspace scan works on each OS.

## Publishing

After artifact verification:

1. Edit the draft release notes.
2. Attach screenshots/GIFs if available.
3. Keep the release marked as prerelease until there are real external testers.
4. Publish.
