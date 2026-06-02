# Environment creation

VOrchestra can create environments directly or from project/template sources.

## Creation modes

- Empty environment using `pip`.
- Empty environment using `uv`.
- Built-in template based on real community workflows.
- Custom template captured from an existing environment.
- Project manifests such as `requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`, and `setup.cfg`.

## Template metadata

When an environment is created from a template, VOrchestra stores and displays the template name on the environment card. Environments without a template show a personalized/custom label.

## Background jobs

Template creation and package installation run as background jobs. The UI should remain responsive and cancellation should be explicit where the operation can take time.

## uv behavior

uv-created environments should keep `uv` as the manager type. VOrchestra uses a workspace-local `UV_CACHE_DIR` for uv operations to avoid global cache permission failures.
