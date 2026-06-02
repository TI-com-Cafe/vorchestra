# Project board

The project board changes the app from venv-first to project-first. Most developers think in projects, not isolated environment folders. Project Board groups environment state around the project root so you can decide what to fix next.

## What it shows

Project Board summarizes:

- Project root.
- Associated environments.
- Best environment health.
- Broken or stale environment indicators.
- Detected manifests.
- Detected lockfiles.
- Next-best actions.
- Manager type such as pip, uv, Conda, or Pixi.

## Why project-first matters

A single project can have multiple environment states over time:

- A `.venv` created by pip.
- A uv environment created later.
- A stale record left after deleting a folder.
- A broken environment after moving a project.
- A lockfile that no longer matches installed packages.

Project Board helps you see the project as the unit of maintenance.

## Detected project files

VOrchestra can detect common Python manifests and project files:

- `requirements.txt`
- `requirements.lock`
- `pyproject.toml`
- `uv.lock`
- `Pipfile`
- `setup.py`
- `setup.cfg`
- Conda environment files
- Pixi manifests

Detected files influence suggested sync and rebuild actions.

## Common actions

Use Project Board to:

- Scan project.
- Open Studio.
- Run diagnostics.
- Repair environment.
- Sync from project manifests.
- Rebuild broken environments from project sources.
- Use uv-native workflows such as `uv sync`, `uv lock`, `uv add`, `uv remove`, and `uv run` when supported.

## Recommended workflow

1. Add a workspace containing projects.
2. Scan the workspace.
3. Open Project Board.
4. Sort attention toward broken, stale, vulnerable, or drifted projects.
5. Open Studio for the project environment.
6. Use Repair Wizard or Package Studio to fix the issue.
7. Re-scan the workspace after destructive changes.

## Native managers

Conda projects are shown as read-only inventory. Pixi projects can be inventoried and support native PyPI dependency writes where safe.
