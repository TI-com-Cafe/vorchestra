# Contributing

VOrchestra is pre-release. Focused changes with clear validation are more useful than broad rewrites.

## Setup

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

## Pull request guidelines

- Branch from `main`.
- Keep PRs focused on one behavior, screen, command group or doc area.
- Include a short test plan.
- Add tests when changing parsers, package operations, background jobs or core state hooks.
- Include screenshots/GIFs for visible UI changes.
- Update `CHANGELOG.md` when behavior changes.

## Code style

Frontend:

- React functional components and hooks.
- Strict TypeScript.
- Avoid `any`; narrow untyped Tauri payloads at the boundary.
- Use shared visual utilities instead of ad hoc styles.
- Do not introduce native `alert`, `prompt`, or `confirm`.

Backend:

- Keep commands domain-oriented under `src-tauri/src/commands/`.
- Heavy work must not block the UI thread.
- Use background jobs for long-running or cancellable work.
- Do not pass user-controlled strings to a shell.
- Preserve Conda read-only behavior; Pixi mutation must stay native, explicit, and tested.

## Targeted validation

Run focused checks while developing, then broader checks before release or large PRs.

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

Full checks:

```bash
npm run check
cd src-tauri && cargo test --all-targets
npm run tauri dev
```

## Backend test seams

- `src-tauri/src/package_managers.rs` centralizes package-manager command construction.
- `src-tauri/src/command_runner.rs` provides a narrow command execution seam.
- Use fake command output for dry-run preview, install-impact, and parser behavior.
- Avoid unit tests that depend on host `pip` or `uv` unless the test is explicitly an integration test.

## Adding a package manager

1. Add an implementation in `src-tauri/src/package_managers.rs`.
2. Implement command builders for install, uninstall, update, check, outdated, freeze, requirements install, install preview, and upgrade preview.
3. Add command-construction tests with fake venv paths.
4. Decide whether the manager can be safely mutated by VOrchestra.
5. Keep unsafe or immature managers read-only, like Conda.
6. Update diagnostics, repair hints, package tree behavior, and UI copy after backend command construction is tested.
