# Health and repair

Health and Repair turn environment problems into explicit actions. The goal is to avoid forcing users to infer the right shell command from a vague error.

## Health score

The health score considers signals such as:

- Missing environment path.
- Broken Python executable.
- Missing pip.
- Missing helper tools.
- Outdated packages.
- Vulnerabilities.
- Lockfile drift.
- Stale database entry.
- Abnormal package or cache size.
- Native manager read-only limitations.

The score is a triage tool. It tells you where to look first.

## Repair Wizard

Repair Wizard presents action cards. Each card should explain what it does and why it is relevant.

Common actions:

- Remove stale inventory entry.
- Install missing pip.
- Install pipdeptree.
- Install pip-audit.
- Re-sync from project manifests.
- Rebuild from requirements, lockfile, or pyproject.
- Set VS Code interpreter.
- Open activated terminal.
- Export support bundle.

## Remove stale entry

Use this when VOrchestra has a record for an environment but the folder is gone.

This action only removes the inventory record. It does not delete environment files because there are no files at that path.

## Install missing pip

Use this when Python exists but `pip` is unavailable. VOrchestra uses the selected environment and runs a repair path such as `ensurepip` where supported.

## Rebuild environment

Rebuild is useful when the environment is broken or polluted but the project has manifests.

Possible rebuild sources:

- `requirements.lock`
- `requirements.txt`
- `uv.lock`
- `pyproject.toml`
- Detected project packages

VOrchestra should show the rebuild source before destructive action.

## VS Code Interpreter Doctor

This checks whether `.vscode/settings.json` points to the selected environment interpreter.

It can identify:

- Missing settings file.
- Wrong interpreter path.
- Missing terminal activation.
- Missing `.env` reference.

## Support bundle

Use support bundle export when reporting bugs. It should contain useful metadata without intentionally collecting secrets.
