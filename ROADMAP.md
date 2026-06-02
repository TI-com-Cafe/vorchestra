# VOrchestra Roadmap

This roadmap starts from `0.1.0`, the first clean public project baseline.

## 0.1.x - Stabilization

Goal: make the source-built app reliable for early testers.

- [ ] Run final real-app smoke test with `npm run tauri dev`.
- [ ] Validate create environment, template creation, workspace scan, package catalog, tree, graph, diagnostics, security, repair, cleanup, Docker, and VS Code flows.
- [ ] Fix any blocker found during real-app smoke testing.
- [ ] Triage Dependabot PRs conservatively; close anything likely to regress Tauri, React, Vite, Vitest, or Rust compatibility.
- [ ] Add screenshots/GIFs to README.
- [ ] Convert good-first-issue candidates into real GitHub issues.

## 0.2 - First Binary Release

Goal: install VOrchestra without Node/Rust.

- [ ] Validate `.github/workflows/release.yml` on a tag.
- [ ] Publish GitHub Release artifacts.
- [ ] Verify Linux `.AppImage` and `.deb`.
- [ ] Verify macOS `.dmg` on Apple Silicon and Intel.
- [ ] Verify Windows installer artifact.
- [ ] Document platform-specific install dependencies.
- [ ] Add a release smoke-test checklist for each OS.

## 0.3 - Product Hardening

Goal: reduce correctness and performance risks in large real workspaces.

- [ ] Performance budget for workspace scan and Studio open.
- [ ] More fixtures for edge-case package metadata and unusual project manifests.
- [ ] More event-driven progress reporting where polling remains as fallback.
- [ ] Broader tests for package mutation, rebuild, import/export, and cache cleanup flows.
- [ ] Clear SQLite migration policy.

## 0.4 - Native Manager Depth

Goal: improve Conda/Pixi support without corrupting native metadata.

- [ ] Better Conda/Pixi inventory views.
- [ ] Native-manager-specific diagnostics guidance.
- [ ] Optional safe native-manager commands if they can be represented without shell risk.
- [ ] Documentation of read-only limitations and user expectations.

## Later Candidates

- Poetry/PDM/Hatch project workflows.
- Remote SSH workspace inventory.
- Plugin API for custom Studio panels.
- Homebrew tap, winget, Flathub, Snap.
- Full i18n.
- Optional telemetry only if users explicitly request it, strictly opt-in.

## Roadmap Policy

Concrete workflows beat broad feature requests. Open an issue with:

- environment manager;
- project files;
- workspace layout;
- action attempted;
- expected result;
- actual result;
- logs/screenshots when available.
