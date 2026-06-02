# First run

The first run should answer one question: where are your Python projects and environments?

## Recommended first workspace

Choose a directory that contains projects, not the whole filesystem.

Good examples:

```bash
~/projects
~/work
/dados/python
```

Avoid `/` unless you intentionally want a very broad scan. Broad scans can discover system folders, take longer, and make it harder to reason about deleted or stale entries.

## Step 1: add a workspace

Use the workspace picker and select your project root. VOrchestra stores workspaces locally in SQLite.

## Step 2: scan the workspace

A scan searches for Python environments and project manifests. It detects common layouts such as:

- `.venv`
- `venv`
- virtualenv folders with `pyvenv.cfg`
- uv-managed environments
- Conda metadata
- Pixi environment layouts

The scan is a background job. You can continue using the app, and you can cancel long scans.

## Step 3: open an environment

Select an environment card and open Studio. Studio is where most environment-specific operations live.

Start with:

1. Package catalog.
2. Health and repair.
3. Diagnostics.
4. Security audit.
5. Project tools.

## Step 4: create an environment if needed

Use the create environment action when a project does not have an environment yet.

Creation options include:

- Empty pip environment.
- Empty uv environment.
- Built-in templates.
- Custom templates.
- Project manifest sources such as `requirements.txt` or `pyproject.toml`.

## Step 5: install helper tools only when needed

VOrchestra does not require every helper globally.

Install helper tools inside the selected environment when the app asks for them:

```bash
python -m pip install pipdeptree
python -m pip install pip-audit
```

For uv environments, VOrchestra adapts install commands to target the selected environment.

## What VOrchestra stores

VOrchestra stores local app state:

- Workspace paths.
- Environment records.
- Custom templates.
- Saved scripts.
- Cached package metadata.

It does not collect telemetry and does not require an account.
