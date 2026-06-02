# Contributor Developer Notes

## Local Setup

Required:

- Node.js 20+
- Rust 1.85+
- Python 3.x
- npm

Recommended:

- `uv`
- `pipdeptree`
- `pip-audit`
- Docker
- VS Code CLI (`code`)

## Common Commands

```bash
npm install
npm run tauri dev
npm run check
npm run build
cd src-tauri && cargo test --all-targets
```

## Targeted Validation

Prefer targeted validation while developing. Run the smallest checks that cover the changed area, then run broad checks before release or large PRs.

Frontend:

```bash
npm run test:frontend:smoke
npm run test:frontend:product
npm run test:frontend:hooks
npm run check:frontend
```

Backend:

```bash
cd src-tauri && CARGO_TARGET_DIR=/tmp/vorchestra-ci-target cargo clippy --lib -- -D warnings
cd src-tauri && CARGO_TARGET_DIR=/tmp/vorchestra-ci-target cargo test package_managers
cd src-tauri && CARGO_TARGET_DIR=/tmp/vorchestra-ci-target cargo test package_analysis
cd src-tauri && CARGO_TARGET_DIR=/tmp/vorchestra-ci-target cargo test diagnostics
```

Use `npm run check` and `cargo test --all-targets` before release, before cross-cutting refactors, or when command registration/migrations changed.

## Backend Test Seams

- `src-tauri/src/package_managers.rs` centralizes package-manager command construction.
- `src-tauri/src/command_runner.rs` provides a narrow command execution seam.
- Use `FakeCommandRunner` for deterministic tests of dry-run and preview logic.
- Do not call real `pip` or `uv` in unit tests unless the test explicitly validates host tool integration.
- Prefer parser fixtures and fake command output for package tree, lockfile drift, package hygiene, cache duplicate, and install-impact behavior.

## Adding A Package Manager

1. Add an implementation in `src-tauri/src/package_managers.rs`.
2. Implement command builders for install, uninstall, update, check, outdated, freeze, requirements install, install preview, and upgrade preview.
3. Add command-construction tests with fake venv paths.
4. Decide whether the manager is mutable in VOrchestra. If not, keep it read-only and document native-manager-only actions.
5. Update diagnostics, repair hints, package tree behavior, and UI copy only after backend command construction is tested.

## Working Principles

- Preserve local-first behavior.
- Keep expensive work in background jobs.
- Add parser fixtures for new parser behavior.
- Keep Dependabot updates conservative until cross-platform Tauri compatibility is proven.
- Avoid shell-string execution for user-controlled values. Prefer structured command builders.
- Stream logs for long-running package, diagnostics, repair, rebuild, restore, and automation jobs when the user needs progress context.
