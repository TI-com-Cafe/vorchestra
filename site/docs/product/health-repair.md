# Health and repair

VOrchestra turns environment state into clear repair actions.

## Health score inputs

- Missing environment path.
- Broken Python executable.
- Missing `pip`.
- Missing helper tools.
- Outdated packages.
- Vulnerabilities.
- Lockfile drift.
- Stale database entry.
- Abnormal package/cache size.
- Native manager read-only limitations.

## Repair Wizard actions

- Remove stale inventory entry.
- Install missing `pip` when supported.
- Install `pipdeptree` or `pip-audit`.
- Re-sync from `pyproject.toml` or `requirements.txt`.
- Rebuild from project sources.
- Set VS Code interpreter.
- Export support bundle.

## Rebuild safety

Rebuild flows should show the rebuild source before destructive action and use recoverable workspace-local trash where possible.
