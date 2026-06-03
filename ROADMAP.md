# VOrchestra Roadmap

`v0.1.0` has already been released with Linux, macOS, and Windows artifacts. This roadmap starts from that shipped baseline and tracks what should improve next.

VOrchestra should remain a local-first desktop control center for Python environment inventory, diagnostics, repair, cleanup, security, and project operations. It should coordinate tools such as `pip`, `uv`, Pixi, Conda, VS Code, Docker, and Jupyter rather than replacing them.

## Released: 0.1.0

Shipped baseline:

- Linux, macOS, and Windows release artifacts.
- Multi-workspace environment inventory.
- `pip`, `uv`, Pixi, and Conda detection workflows.
- Environment creation from templates and project manifests.
- Project-first board.
- Environment Health Score.
- Repair Wizard.
- Disk Cleanup Mode.
- Package Studio with package list, package sources, dependency tree, graph, install preview, editable install detection, and package actions.
- Background jobs, cancellation, and streaming logs for heavy workflows.
- Diagnostics, outdated checks, security scan, metadata audit, SBOM export, and policy checks.
- Snapshots and rollback support for risky project operations.
- VS Code, Jupyter, Docker, pre-commit, `.env`, and automation-script workflows.
- Local-first AI explanation through optional Ollama.
- CI, release workflow, issue templates, PR template, security policy, contribution guide, code of conduct, and repository metadata.

## 0.1.x - Stabilization

Goal: make the released app more reliable from real user feedback.

Planned work:

- Improve first-run guidance and empty-state copy.
- Improve workspace scan cancellation when users delete environments during active scans.
- Improve handling of broken, moved, or partially deleted environments.
- Improve dependency graph layout for dense package sets.
- Improve install-impact preview behavior for older `pip` and `uv` versions.
- Improve offline behavior when cached package metadata is available.
- Add more fixtures for dependency trees, package manager output, policy checks, package hygiene, cache cleanup, and snapshot rollback.
- Expand release notes and known-issues tracking for patch releases.
- Convert good-first-issue candidates into real GitHub issues.

## 0.2.x - Product Hardening

Goal: make VOrchestra more actionable for project maintenance and team workflows.

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
  - better Conda/Pixi inventory details;
  - cleaner extension points for future managers such as Poetry or PDM.
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

Goal: keep the desktop UI responsive as environments and workspaces grow.

Planned work:

- Continue tuning virtualized package list and tree rendering.
- Add safer graph defaults for very large environments.
- Improve progress logs for long-running package manager operations.
- Add clearer cancel states for remaining heavy workflows.
- Reduce visual repetition in Studio tabs while preserving context.
- Improve light and dark theme contrast from screenshots and user feedback.

## Contributor Track

Goal: make contribution safe and predictable.

Planned work:

- Keep `main` protected with PR review and required CI.
- Expand good-first-issue backlog from real bugs and UX gaps.
- Add more deterministic Rust tests using fake command runners.
- Add frontend smoke tests for critical user flows.
- Document package manager extension points as they stabilize.
- Keep dependency updates conservative until cross-platform release compatibility is proven.

## Later Exploration

These are useful but lower priority than local environment maintenance quality.

- Remote SSH workspace inventory.
- Plugin system.
- Full i18n.
- Homebrew, winget, Flathub, or Snap distribution.
- Optional telemetry, only if strictly opt-in and justified by real maintenance needs.
- Cloud integrations, only if they do not compromise the local-first model.

## Roadmap Policy

Concrete workflows beat broad feature requests. Open an issue with:

- environment manager;
- project files;
- workspace layout;
- action attempted;
- expected result;
- actual result;
- logs or screenshots when available.
