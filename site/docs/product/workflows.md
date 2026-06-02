# User workflows

This page describes the common end-to-end workflows VOrchestra is designed to support.

## Inventory existing environments

Use this when you already have many projects and do not remember where every environment lives.

1. Add a workspace root.
2. Start scan.
3. Review environment cards.
4. Open broken or stale environments first.
5. Use Project Board to group environments by project root.

Expected result:

- Existing environments appear in the workspace inventory.
- Missing paths are marked stale instead of silently ignored.
- Native Conda/Pixi environments are shown as read-only inventory.

## Create a project environment

Use this when a project has no environment yet.

1. Choose the project workspace.
2. Pick pip or uv.
3. Choose empty creation, a template, or detected project manifests.
4. Watch the background job log.
5. Open Studio after creation.

Expected result:

- Template-created environments show the template name on the card.
- uv-created environments keep `uv` as manager type.
- Package installation logs stream in the UI instead of looking frozen.

## Repair a broken environment

Use this when an environment card reports a broken path, missing Python, missing pip, missing helper tools, drift, or stale DB entry.

1. Open Studio.
2. Open Repair.
3. Read the health score inputs.
4. Pick the smallest repair action that addresses the issue.
5. Re-run the package catalog or diagnostics after repair.

Common actions:

- Remove stale entry.
- Install missing pip.
- Install pipdeptree.
- Install pip-audit.
- Re-sync from project manifests.
- Rebuild from requirements or pyproject.
- Set VS Code interpreter.

## Clean disk usage

Use this when venvs and Python caches are consuming too much disk.

1. Open cleanup surfaces.
2. Review large environments.
3. Review duplicate wheel cache groups.
4. Review stale environments.
5. Delete or purge only after confirming the path and reason.

Safety expectation:

- VOrchestra should explain what will be removed.
- Environment deletion should tolerate missing folders and remove stale inventory entries.
- Broad destructive cleanup should require explicit confirmation.

## Investigate package risk

Use this when you need to understand dependency, security, license, or size risk.

1. Open Package Studio.
2. Load package catalog.
3. Sort by size or filter unknown-size packages.
4. Open Tree or Graph for dependency shape.
5. Use Why installed for unexpected packages.
6. Run Security and Metadata audit.
7. Export SBOM if needed.

Expected result:

- Long package operations stream logs.
- Large lists and trees remain responsive through virtualization.
- Missing helper tools show install guidance and action buttons.

## Prepare a project for development

Use this when onboarding a local project.

1. Open Studio for the project environment.
2. Generate VS Code settings.
3. Run VS Code Interpreter Doctor.
4. Register Jupyter kernel if notebooks are used.
5. Configure `.env` values.
6. Generate Docker files if needed.
7. Install pre-commit hooks.
8. Save project scripts for repeated commands.

Expected result:

- VS Code points at the selected interpreter.
- `.env.example` missing keys are visible.
- Automation commands run in background jobs and stream output.
