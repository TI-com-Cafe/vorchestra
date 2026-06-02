# Package Studio

Package Studio is the environment dependency workspace. Use it to understand what is installed, why it exists, how much space it uses, whether it is risky, and what package operations are available.

## Package catalog

The package catalog reads installed distributions from the selected environment. It is separate from package size calculation so the UI can show packages even when size scanning is still running or unavailable.

The package list supports:

- Search by package name.
- Sort by name or size.
- Filter large packages.
- Filter packages with known size.
- Filter packages with unknown size.
- Virtualized rendering for large environments.

If the list says packages are still cataloging for too long, cancel active jobs and check the environment health. Broken Python or missing pip can prevent package reads.

## Package actions

For mutable pip and uv environments, VOrchestra supports:

- Install.
- Uninstall.
- Update.
- Export requirements.
- Preview upgrade.
- Check install conflicts.
- Ask why a package is installed.

For Conda and Pixi environments, package mutation is read-only in VOrchestra. Use the native manager for changes.

## Install sources

Package Studio supports multiple install sources:

- PyPI.
- Test PyPI.
- Git URL.
- Local file.
- Local project.
- Editable local project.
- Custom direct URL.

See [Package sources](./package-sources.md) for details and safety guidance.

## Install preview

Install preview and upgrade preview run dry-run commands where the selected manager supports them.

Use preview to understand:

- Direct package target.
- Transitive dependencies.
- Possible upgrades.
- Resolver output.
- Whether preview is unavailable for the current manager or version.

If preview is unavailable, VOrchestra should explain why and still allow the normal install path when safe.

## Editable installs

Editable installs link an environment package to a source project.

VOrchestra detects editable installs where metadata is available and shows source information. Uninstalling an editable package removes the environment link, not the source directory.

## Dependency tree

Tree view explains package hierarchy.

For pip environments, `pipdeptree` is required. If missing, VOrchestra shows:

- Installation text.
- Install button targeting the selected environment.
- Button to open a terminal with the install command.

For uv environments, VOrchestra uses uv-aware behavior where possible and falls back to metadata-driven tree logic when necessary.

Large trees use virtual rendering, so expanding a large environment should not freeze the UI.

## Dependency graph

Graph view shows dependency shape visually. It is intentionally capped for responsiveness.

Controls include:

- Top-level-only mode.
- Depth levels.
- Full capped mode.
- Search/filter.
- Dependency hub focus.

For very large environments, start with Top only or Level 1, then focus a hub or use Tree search for exact inspection.

## Package sizes

Package size calculation scans installed package directories and can take time. Unknown size means the package was detected but reliable disk allocation was not available yet.

Use size filters to identify cleanup candidates.

## Logs and cancellation

Package mutation jobs stream output into the UI. Use logs to understand resolver progress, downloads, build failures, permission errors, and cancellation.
