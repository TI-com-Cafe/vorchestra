# Agent Workflow

This repository should optimize for focused execution and low AI spend without lowering review quality.

## Language And Style

- Use English for repo-facing work and future assistant responses.
- Be concise. Avoid status filler and repeated summaries.
- Prefer direct implementation over long planning when the task is clear.

## Model Allocation

Use simpler/cheaper agents for bounded, low-risk work:

- **Repo scout**: locate files, summarize existing behavior, list impacted tests. Read-only.
- **Test updater**: update or add tests for already-defined behavior. Do not change production code.
- **Docs updater**: update README/docs/changelog/release notes from completed changes only.
- **Lint/type triage**: inspect compiler/test failures and propose the minimal fix.
- **UI copy pass**: improve labels, empty states and helper text without changing behavior.

Keep stronger models for work that can regress core behavior:

- Backend command execution, process spawning, filesystem deletion, database writes.
- Tauri job lifecycle, cancellation, events and concurrency.
- Package manager behavior for pip/uv, lockfile restore, rebuild, repair and security flows.
- Cross-cutting refactors or anything touching multiple app layers.
- Final integration review before commit/push.

## Delegation Rules

- Delegate only independent side tasks; do not duplicate the same investigation in multiple agents.
- Give each agent a narrow scope, expected output and ownership boundary.
- Workers must not revert unrelated changes or edit files outside their assigned scope.
- Main agent integrates and reviews all changes before commit.

## Test Policy

Run the smallest test set that covers the changed behavior first.

- UI component change: run the specific component test file.
- Studio/package UX change: run `npm run test:frontend:product` or the narrower smoke test if enough.
- Hook/service change: run `npm run test:frontend:hooks`.
- App shell/overlay flow: run `npm run test:frontend:app`.
- Rust/backend command change: run targeted `cargo test <module_or_test>` from `src-tauri`, then `npm run check:rust`.
- Type-level frontend change: run `npm run check:frontend`.

Run broader suites only when needed:

- Cross-cutting frontend behavior: `npm run test:frontend:components`.
- Pre-push or release candidate: `npm run check`.
- After dependency upgrades: full frontend tests plus Rust check.

Avoid repeatedly running the full harness for unrelated small edits. If a targeted test passes but risk remains, state the residual risk and choose the next smallest relevant test.

@RTK.md
