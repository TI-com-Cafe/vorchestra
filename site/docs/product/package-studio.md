# Package Studio

Package Studio is the environment dependency workspace.

## Capabilities

- Search, sort and filter installed packages.
- Install, uninstall and update packages.
- Export requirements.
- Search PyPI and choose package versions.
- Install from PyPI, Test PyPI, Git, URL, local file, or local project.
- Preview compatibility conflicts.
- See package sizes separately from initial package cataloging.
- Explore dependency tree and graph views.
- Ask why a package is installed.
- Preview upgrades before applying them.

## Dependency tree helpers

For pip environments, `pipdeptree` is required for the richer tree view. If missing, VOrchestra shows install instructions and action buttons for the selected environment.

For uv environments, VOrchestra adapts commands to uv where possible.
