# Environment managers

VOrchestra supports multiple environment managers with different mutation levels. The app should adapt to the manager instead of assuming every environment behaves like pip.

## pip

pip environments are fully mutable in VOrchestra.

Supported workflows include:

- Package cataloging.
- Install, update, and uninstall.
- Requirements export.
- Dependency tree with `pipdeptree`.
- Dependency graph.
- Diagnostics.
- Security audit with `pip-audit`.
- Package hygiene.
- Repair actions.
- Lockfile generation and restore.

VOrchestra uses `python -m pip` so package operations target the selected environment's Python executable.

## uv

uv environments are mutable where VOrchestra has explicit uv-aware commands.

Supported or intended workflows include:

- Fast environment creation.
- `uv pip` package operations targeted at the selected Python executable.
- `uv sync`.
- `uv lock`.
- `uv add`.
- `uv remove`.
- `uv run`.
- uv-aware lock and project flows.

VOrchestra uses workspace-local `UV_CACHE_DIR` values in several uv operations to reduce global cache permission issues.

uv CLI versions can differ. If a uv command fails with an unexpected argument, check the installed uv version and command help:

```bash
uv --version
uv tree --help
uv pip install --help
```

## Conda

Conda environments are detected as read-only inventory.

VOrchestra can show them, inspect some metadata, and guide the user, but package mutation should happen through Conda:

```bash
conda install package-name
conda update --all
conda env export
```

## Pixi

Pixi environments are detected as native-manager environments. VOrchestra supports native PyPI dependency writes through Pixi where safe.

Use Pixi for mutation:

```bash
pixi add package-name
pixi update
pixi run command
```

## Why read-only managers exist

Mutating manager-native metadata incorrectly can break projects. VOrchestra keeps Conda read-only and only performs Pixi mutations through native Pixi commands that are intentionally designed and tested.

## Future managers

Future candidates include Poetry, PDM, Hatch, and deeper Pixi/Conda support. New managers should be added through the Rust package manager abstraction and covered by command-construction tests.
