# Changelog

All notable changes to VOrchestra are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

- Stabilize the `0.1.x` release line from real user feedback.
- Improve workspace scan cancellation when users delete environments during active scans.
- Improve dependency graph layout for dense environments.
- Add more parser and package-manager fixtures for edge cases.
- Expand offline behavior for cached package metadata.

## [0.1.0] - 2026-06-01

### Added

- VOrchestra project identity, Apache-2.0 license, and public repository metadata.
- Local-first Tauri 2 desktop application for Python virtual environment orchestration.
- Multi-workspace inventory with SQLite cache.
- Environment creation through `pip` and `uv`.
- Built-in and custom environment templates.
- Project import from common Python manifests.
- Project-first board with environment grouping and next-best actions.
- Environment Health Score.
- Repair Wizard with guided actions and rebuild-from-project workflow.
- Disk Cleanup Mode for caches, duplicate wheels, stale environments, large environments, and missing entries.
- Package Studio with package list, dependency tree, graph, package sizes, PyPI/Git/URL/file/project install sources, compatibility preview, why-installed, and upgrade preview.
- Explicit/cancellable diagnostics, outdated package checks, security scan, package metadata audit, and SBOM export.
- Read-only Conda and Pixi inventory support.
- Structured `.env` editor with `.env.example` awareness and secret masking.
- VS Code Interpreter Doctor and settings generation.
- Jupyter kernel registration.
- Docker manifest generation and terminal-based Docker run.
- Pre-commit hook setup.
- Saved automation scripts and quick tool runners.
- Background job infrastructure with cancellation for major heavy workflows.
- Frontend product harness, component/hook tests, and Rust parser/helper tests.
- GitHub CI, release workflow scaffold, Dependabot configuration, issue templates, PR template, security policy, contribution guide, code of conduct, and project docs.

### Changed

- Public project name standardized as VOrchestra.
- Version set to `0.1.0` across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Dark theme switched to a Monokai-inspired palette with solid card surfaces.

### Known Limitations

- Conda support is inventory-first and read-only.
- Pixi support is available for inventory and selected PyPI dependency writes, but native Pixi workflows are still expanding.
- Dependency graphs for very dense environments can still need better automatic layout defaults.
- Some package-manager preview behavior depends on the installed `pip` or `uv` version.
