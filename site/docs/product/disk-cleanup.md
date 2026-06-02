# Disk Cleanup Mode

Disk cleanup helps identify where Python environments and caches consume space. It is designed for users with many projects and many old virtual environments.

## What it can find

VOrchestra can surface:

- Large environments.
- Stale environments whose folders no longer exist.
- Old environments that have not changed recently.
- Duplicate wheel cache groups.
- Cache directories that can be purged safely.
- Packages with abnormal or unknown size.
- Orphan package candidates from package hygiene analysis.

## Cleanup principles

Cleanup must be explainable. Before deleting anything, the UI should show:

- Path.
- Reason.
- Estimated size when known.
- Whether the target exists on disk.
- Whether the action removes files or only removes a database record.

## Stale inventory entries

A stale entry is a VOrchestra database record whose folder no longer exists on disk.

Removing a stale entry does not delete files. It only removes the local inventory record.

## Environment deletion

If the folder exists, deletion removes the environment folder. If the folder does not exist, VOrchestra treats the action as stale-entry cleanup and removes the inventory record.

## Cache cleanup

Cache cleanup should target known safe cache locations, not arbitrary user paths.

Examples:

- pip cache.
- uv cache used by VOrchestra operations.
- duplicate wheel groups.

## Recommended workflow

1. Start with stale entries.
2. Review largest environments.
3. Review duplicate caches.
4. Confirm paths before deletion.
5. Re-scan the workspace.
6. Re-open Studio for affected projects.
