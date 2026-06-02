# VOrchestra documentation

VOrchestra is a local-first desktop control center for Python virtual environments. It helps developers discover, inspect, repair, secure, clean up, and operate environments across local workspaces.

## What VOrchestra is for

- Inventory many `.venv` folders without remembering where each project keeps them.
- Detect broken, stale, outdated, vulnerable, oversized, or incomplete environments.
- Repair common issues without guessing the right `pip`, `uv`, `pipdeptree`, or `pip-audit` command.
- Understand dependency trees, package sizes, upgrade risk, lock drift, and why a package is installed.
- Run project-level operations such as VS Code interpreter setup, Jupyter kernel registration, Docker files, `.env` editing, pre-commit setup, and quick scripts.

## What it is not

VOrchestra does not replace `uv`, `pip`, Conda, Pixi, VS Code, Docker, Jupyter, or your shell. It coordinates those tools locally and shows their state in one place.

## Current status

Version `0.1.0` is a published pre-release with native installers for Linux, Windows, and macOS.

Download it from the GitHub release:

https://github.com/TI-com-Cafe/vorchestra/releases/tag/v0.1.0

## Documentation map

- [Installation](./start/installation.md): install the desktop app or choose the source build path.
- [Quick start](./start/quickstart.md): add a workspace, scan, and open Studio.
- [First run](./start/first-run.md): recommended first workspace and first useful actions.
- [User workflows](./product/workflows.md): inventory, creation, repair, cleanup, package risk, and project setup.
- [Product overview](./product/overview.md): understand the main product surfaces.
- [Troubleshooting](./reference/troubleshooting.md): common failures and fixes.
- [FAQ](./reference/faq.md): common product and behavior questions.
- [Architecture](./reference/architecture.md): frontend, backend, jobs, and commands.
- [Roadmap](./community/roadmap.md): planned release direction.
