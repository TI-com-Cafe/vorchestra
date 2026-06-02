# Package sources

Package Studio can install packages from multiple sources. The exact behavior depends on the selected environment manager.

## PyPI

Use PyPI for normal package installation.

Example package names:

```text
requests
fastapi
django
pytest
```

VOrchestra can search package metadata, show cached results when available, and install the selected package into the active environment.

## Test PyPI

Use Test PyPI when validating packages before a real PyPI release.

The app builds an install command that targets the test index. Use this only when you understand that dependencies may still come from PyPI or may need an extra index.

## Git repository

Use Git sources for packages hosted in repositories.

Typical source shape:

```text
git+https://github.com/owner/project.git
```

For branch, tag, or commit installs, use a valid pip-compatible Git URL.

## Local file

Use a local wheel, source distribution, or archive when you have a package file on disk.

Examples:

```text
./dist/my_package-0.1.0-py3-none-any.whl
./dist/my_package-0.1.0.tar.gz
```

## Local project

Use local project install when you are developing a package from source.

Editable install is supported when selected:

```bash
pip install -e ./my-project
```

VOrchestra detects editable installs and shows source information where available. Uninstalling an editable package removes the environment link, not the source project.

## Custom URL

Use a direct package URL only when you trust the source. Prefer PyPI, Test PyPI, Git, local file, or local project when possible.

## Manager behavior

pip environments:

- Support package mutation through `python -m pip`.
- Support dry-run previews when pip supports them.
- Use `pipdeptree` for rich dependency tree support.

uv environments:

- Use `uv pip` commands targeted at the selected Python executable.
- Use workspace-local uv cache paths to reduce permission issues.
- Need command compatibility checks because uv CLI behavior can differ by version.

Conda and Pixi environments:

- Are currently read-only inventory targets.
- Mutate them with their native manager outside VOrchestra.
