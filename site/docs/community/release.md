# Release process

VOrchestra releases are built from Git tags through `.github/workflows/release.yml`.

## Current version

`0.1.0`

## Release requirements

Before tagging:

- `main` is green in CI.
- `CHANGELOG.md` has a dated release entry.
- Version is consistent in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
- README reflects install state and known limitations.
- Real app smoke test passed with `npm run tauri dev`.
- Dependabot PRs likely to regress the app are closed or deferred.

## Local preflight

```bash
npm run check
npm run build
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test --all-targets
```

## Tagging

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow creates a draft prerelease.
