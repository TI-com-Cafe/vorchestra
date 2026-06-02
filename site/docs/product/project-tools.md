# Project tools

Studio includes project-level tools next to package and diagnostics workflows. These tools help turn an environment into a usable development setup.

## Configuration

The Config tab includes a structured `.env` editor.

Capabilities:

- Read and write `.env` in the project root.
- Detect keys declared in `.env.example` or `.env.template`.
- Show missing declared variables.
- Mask secret-like values such as keys, tokens, passwords, and secrets.
- Toggle raw edit mode when needed.
- Inspect `pyvenv.cfg` as read-only environment metadata.

Use structured mode for normal edits. Use raw mode when preserving exact formatting matters.

## Automation

Automation lets you save and run environment-specific scripts.

Examples:

```bash
pytest
ruff check .
black .
mypy .
python manage.py migrate
python -m build
```

Long-running scripts execute as background jobs and stream logs. This keeps the UI responsive and gives you output while the command runs.

## Activated terminal

Open an activated terminal when you need manual shell control. This is useful for commands VOrchestra does not yet model directly.

Prefer built-in structured actions when they exist because they provide better progress, cancellation, and safety checks.

## VS Code settings

VOrchestra can generate `.vscode/settings.json` entries for the selected environment.

It can set:

- `python.defaultInterpreterPath`
- terminal activation
- `.env` file reference

Existing unrelated settings should be preserved.

## VS Code Interpreter Doctor

Interpreter Doctor checks whether VS Code points at the selected environment.

It reports:

- Missing settings file.
- Wrong interpreter path.
- Missing terminal activation.
- Missing `.env` reference.

Use it when VS Code runs a different interpreter than the one selected in VOrchestra.

## Jupyter kernel registration

Register a Jupyter kernel when the selected environment should appear in notebooks.

If `ipykernel` is missing, VOrchestra shows manager-specific install guidance.

## Docker tools

VOrchestra can generate Docker-related files and open a terminal to run build/run commands.

Use this for quick local container validation. Review generated files before saving them into production projects.

## Pre-commit hooks

VOrchestra can install `pre-commit`, create a starter `.pre-commit-config.yaml` when missing, and run `pre-commit install` in the project root.

This requires the project root to be a Git repository. If it is not, initialize Git first:

```bash
git init
```
