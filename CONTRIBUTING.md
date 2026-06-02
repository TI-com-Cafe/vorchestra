# Contributing to VOrchestra

Thanks for helping improve VOrchestra. This project is still pre-release, so focused changes with clear validation are more useful than broad rewrites.

## Project Status

- Current version: `0.1.0`
- Primary branch: `main`
- License: Apache-2.0
- Product direction: local-first Python environment inventory, diagnostics, repair, cleanup, and project operations

## Prerequisites

- Node.js 20+
- npm
- Rust 1.85+
- Python 3.x
- Linux Tauri/WebKit dependencies when developing on Linux

Recommended optional tools:

- `uv`
- Docker
- VS Code CLI (`code`)
- Jupyter + `ipykernel`
- Conda/Pixi for read-only native-manager inventory testing

## Setup

```bash
git clone https://github.com/TI-com-Cafe/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

## Contribution Flow

`main` is protected. Direct pushes are not accepted for normal contribution work.

1. Fork the repository or create a topic branch from `main`.
2. Keep the branch focused on one feature, bug fix, or documentation area.
3. Run targeted validation while developing.
4. Run the broader checks before opening the PR when the change is cross-cutting.
5. Open a pull request against `main`.
6. Fill in the PR description with scope, risk, and validation performed.
7. Wait for CI to pass.
8. Address review feedback without force-pushing over reviewer context unless necessary.
9. Keep the PR branch up to date with `main` when GitHub reports it is behind.

Current `main` merge requirements:

- One approving review.
- Stale reviews are dismissed when new commits are pushed.
- The last pusher cannot approve their own final push.
- All required CI checks must pass.
- The PR branch must be up to date with `main`.
- Review conversations must be resolved.
- Linear history is required.
- Force-pushes and branch deletion on `main` are blocked.

## Validation Strategy

Use targeted checks while iterating:

```bash
npm run check:frontend
npm run test:frontend:product
npm run check:rust
npm run test:rust
```

Before opening a PR, run:

```bash
npm run check
```

For Rust changes, also run when relevant:

```bash
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test --all-targets
```

## Pull Request Guidelines

- Branch from `main`.
- Do not open broad refactor PRs mixed with product changes.
- Keep PRs focused on one behavior, screen, command group, or doc area.
- Include a short test plan.
- Link related issues when applicable.
- Add tests when changing parsers, package operations, background jobs, or core state hooks.
- Include screenshots/GIFs for visible UI changes.
- Update `CHANGELOG.md` under `[Unreleased]` when behavior changes.

## Commit Messages

Use Conventional Commits:

- `feat:` new user-facing capability
- `fix:` bug fix
- `docs:` documentation only
- `style:` visual/UI-only changes without behavior change
- `refactor:` internal cleanup without behavior change
- `test:` tests only
- `chore:` tooling, dependency, or repository maintenance
- `perf:` performance improvement

## Code Style

### Frontend

- React functional components and hooks.
- Strict TypeScript.
- Avoid `any`; narrow untyped Tauri payloads at the boundary.
- Use `cn()` for conditional class composition.
- Prefer shared visual utilities such as `vo-surface`, `vo-panel`, `vo-subpanel`, `vo-control`, `vo-primary-action`, and `vo-secondary-action`.
- Do not introduce native `alert`, `prompt`, or `confirm`; use app UI.

### Backend

- Keep commands domain-oriented under `src-tauri/src/commands/`.
- Heavy work must not block the UI thread.
- Use background jobs for long-running or cancellable work.
- Do not pass user-controlled strings to a shell.
- Prefer structured command arguments and explicit allow-lists.
- Preserve Conda/Pixi read-only behavior unless native-manager mutation is intentionally designed and tested.

## Issues

Use the issue templates. A good bug report includes:

- VOrchestra version or commit SHA.
- OS and Python version.
- Environment manager (`pip`, `uv`, Conda, Pixi).
- Workspace layout.
- Steps to reproduce.
- Expected behavior.
- Actual behavior.
- Logs or screenshots.

## Good First Issues

See [`docs/GOOD_FIRST_ISSUES.md`](./docs/GOOD_FIRST_ISSUES.md). When the public issue tracker is populated, issues labeled `good first issue` should map back to that document.

## Code of Conduct

This project follows [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contribution is licensed under Apache-2.0.
