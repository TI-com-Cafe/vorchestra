# Roadmap

## 0.1.x - Stabilization

Goal: make the source-built app reliable for early testers.

- Run final real-app smoke test with `npm run tauri dev`.
- Validate create environment, template creation, workspace scan, package catalog, tree, graph, diagnostics, security, repair, cleanup, Docker and VS Code flows.
- Fix blockers found during real-app smoke testing.
- Triage Dependabot PRs conservatively.
- Add screenshots/GIFs.
- Convert good-first-issue candidates into GitHub issues.

## 0.2 - First binary release

Goal: install VOrchestra without Node/Rust.

- Validate `.github/workflows/release.yml` on a tag.
- Publish GitHub Release artifacts.
- Verify Linux `.AppImage` and `.deb`.
- Verify macOS `.dmg`.
- Verify Windows installer artifact.
- Document platform-specific install dependencies.

## 0.3 - Product hardening

Goal: reduce correctness and performance risks in large real workspaces.

- Performance budget for workspace scan and Studio open.
- More fixtures for package metadata and unusual project manifests.
- More event-driven progress reporting where polling remains as fallback.
- Broader tests for package mutation, rebuild, import/export and cleanup.
- Clear SQLite migration policy.

## Later candidates

- Poetry/PDM/Hatch workflows.
- Remote SSH workspace inventory.
- Plugin API for custom Studio panels.
- Homebrew tap, winget, Flathub and Snap.
- Full i18n.
- Strictly opt-in telemetry only if users request it.
