# Product overview

VOrchestra is organized around local Python environment maintenance.

## Core workflows

<div class="workflow-grid">
  <div class="workflow-card"><h3>Inventory</h3><p>Find environments across workspaces and keep a fast local cache.</p></div>
  <div class="workflow-card"><h3>Health</h3><p>Score environments by broken state, stale records, missing tools, drift and security issues.</p></div>
  <div class="workflow-card"><h3>Repair</h3><p>Guide common fixes instead of leaving users to infer shell commands.</p></div>
  <div class="workflow-card"><h3>Cleanup</h3><p>Find large/stale environments, duplicate wheels, caches and missing inventory records.</p></div>
  <div class="workflow-card"><h3>Security</h3><p>Run audit, metadata hygiene, suspicious name hints and SBOM export.</p></div>
  <div class="workflow-card"><h3>Project operations</h3><p>Work from project roots: manifests, lockfiles, Docker, VS Code, Jupyter, .env and scripts.</p></div>
</div>

## Product principle

VOrchestra should not compete with package managers on generic package management. Its advantage is transversal visibility across the machine and guided maintenance.

## Main surfaces

Workspace inventory:

- Add local project roots.
- Scan for environments.
- Detect stale or broken entries.
- Open Studio for a selected environment.

Project Board:

- Group environment state by project root.
- Show manifests and lockfiles.
- Suggest next actions based on project context.

Studio:

- Package catalog, package actions, tree, graph, and package risk.
- Diagnostics, security audit, and metadata hygiene.
- Health score and Repair Wizard.
- Lockfile, drift, and rebuild workflows.
- `.env`, automation scripts, VS Code, Jupyter, Docker, and pre-commit integrations.

Cleanup:

- Large environment review.
- Duplicate cache review.
- Stale entry removal.
- Package size triage.

## Recommended reading

If you are new to the app, read these pages in order:

1. [Installation](../start/installation.md)
2. [Quick start](../start/quickstart.md)
3. [User workflows](./workflows.md)
4. [Package Studio](./package-studio.md)
5. [Health and repair](./health-repair.md)
6. [Troubleshooting](../reference/troubleshooting.md)
