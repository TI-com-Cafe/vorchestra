# Environment managers

VOrchestra supports multiple environment managers with different mutation levels.

## pip

pip environments support package cataloging, package mutation, dependency tree helpers, diagnostics, security scans, package hygiene and repair actions.

## uv

uv environments support fast creation and uv-native project workflows where available:

- `uv sync`
- `uv lock`
- `uv add`
- `uv remove`
- `uv run`
- `uv tree`

VOrchestra must account for uv CLI version differences. Commands should be built from supported arguments, not assumed from a newer version.

## Conda and Pixi

Conda and Pixi are detected as read-only inventory. VOrchestra can inspect and guide, but it should not mutate native manager metadata unless a future workflow is explicitly designed and tested.
