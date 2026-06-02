# Disk Cleanup Mode

Disk cleanup helps identify where Python environments and caches consume space.

## Cleanup surfaces

- Cache summary.
- Allow-listed cache purge.
- Duplicate wheel groups.
- Large environments.
- Stale environments.
- Missing inventory entries.
- Orphan package candidates.

## Safety rule

Cleanup should be explainable before destructive action. Prefer preview, explicit confirmation, and recoverable trash for environment deletion/rebuild flows.
