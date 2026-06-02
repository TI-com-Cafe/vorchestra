# Workspaces

Workspaces are directories VOrchestra scans for Python environments.

## Supported behavior

- Add and remove workspace roots.
- Mark a default workspace.
- Scan recursively for virtual environments.
- Adopt existing environments discovered on disk.
- Keep SQLite inventory in sync.
- Remove stale entries when a folder no longer exists.
- Cancel long scans and prevent deleted paths from being re-adopted by an active scan.

## Practical guidance

Avoid adding `/` as a workspace unless you intentionally want a broad scan. Large roots can be slow and may discover system paths that should not be managed.

Use narrower roots such as:

```bash
~/projects
~/work
/dados/python
```

## Scan depth

Set `VORCHESTRA_SCAN_MAX_DEPTH` to control recursion depth:

```bash
VORCHESTRA_SCAN_MAX_DEPTH=12 npm run tauri dev
```
