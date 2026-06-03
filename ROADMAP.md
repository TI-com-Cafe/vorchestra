# VOrchestra Roadmap

This roadmap tracks product direction after the `v0.1.0` public release. It is intentionally product-focused: VOrchestra should remain a local-first desktop control center for Python environment inventory, diagnostics, repair, cleanup, security, and project operations.

## Current Baseline: 0.1.x

Already available in the first public release:

- Multi-workspace environment inventory.
- `pip`, `uv`, Pixi, and Conda detection workflows.
- Environment creation from templates and project manifests.
- Project-first board.
- Environment Health Score.
- Repair Wizard.
- Disk Cleanup Mode.
- Package Studio with package sources, dependency tree, graph, install preview, editable install detection, and package actions.
- Background jobs, cancellation, and streaming logs for heavy workflows.
- Diagnostics, outdated checks, security scan, metadata audit, SBOM export, and policy checks.
- Snapshots and rollback support for risky project operations.
- VS Code, Jupyter, Docker, pre-commit, `.env`, and automation-script workflows.
- Local-first AI explanation through optional Ollama.
- Linux, macOS, and Windows release artifacts.

## Near-Term: 0.1.x Stabilization

Focus: fix real user friction, reduce false positives, and make the first release easier to trust.

Planned work:

- Improve first-run guidance and empty-state copy.
- Add more repair actions for broken or partially deleted environments.
- Improve workspace scan cancellation and conflict handling when users delete environments during scans.
- Improve package graph layout for dense dependency sets.
- Add more fixtures for dependency trees, package manager output, policy checks, and snapshot rollback.
- Expand install-impact preview coverage for edge cases in older `pip` and `uv` versions.
- Improve offline behavior for cached PyPI/package metadata.
- Improve release notes and known-issues tracking per patch release.

## Next Product Layer: 0.2.x

Focus: make VOrchestra more actionable for project maintenance and team workflows.

Planned work:

- Policy Engine improvements:
  - richer `vorchestra.toml` rules;
  - clearer policy violation explanations;
  - optional install blocking for high-risk packages.
- Time Machine improvements:
  - clearer snapshot history;
  - one-click undo for selected operations;
  - better rollback validation.
- Package Manager expansion:
  - stronger Pixi write workflows;
  - better Conda/Pixi read-only inventory details;
  - cleaner abstractions for adding future managers such as Poetry or PDM.
- Project-first workflows:
  - better manifest sync guidance;
  - clearer lockfile drift detection;
  - import-existing-project flow improvements.
- Security and compliance:
  - stronger license summaries;
  - package deprecation and abandonment hints;
  - more precise typosquatting signals;
  - improved SBOM metadata.

## Performance And UX Track

Focus: keep the app responsive as environments and workspaces grow.

Planned work:

- Continue tuning virtualized package list and tree rendering.
- Add safer graph defaults for very large environments.
- Improve progress logs for long-running package manager operations.
- Add clearer cancel states for remaining heavy workflows.
- Reduce visual repetition in Studio tabs while preserving context.
- Improve light and dark theme contrast from real screenshots and user feedback.

## Contributor Track

Focus: make contribution safer and easier.

Planned work:

- Keep `main` protected and require PR review plus CI.
- Expand good-first-issue backlog from real bugs and UX gaps.
- Add more deterministic Rust tests using fake command runners.
- Add frontend smoke tests for critical user flows.
- Document package manager extension points as they stabilize.
- Keep dependency updates conservative until cross-platform release compatibility is proven.

## Later Exploration

These are useful but intentionally lower priority than local environment maintenance quality.

- Remote SSH workspace support.
- Plugin system.
- Full i18n.
- Homebrew, winget, Flathub, or Snap distribution.
- Optional telemetry, only if strictly opt-in and justified by real maintenance needs.
- Cloud integrations, only if they do not compromise the local-first model.

## Product Principle

VOrchestra should not compete with `pip`, `uv`, Pixi, Conda, VS Code, Docker, or Jupyter as a generic replacement. It should coordinate them and solve the cross-environment problems they do not solve well:

- inventory;
- diagnosis;
- repair;
- cleanup;
- security posture;
- drift detection;
- operational visibility across local projects.
