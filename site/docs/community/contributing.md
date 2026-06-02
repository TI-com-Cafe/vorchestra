# Contributing

VOrchestra is pre-release. Focused changes with clear validation are more useful than broad rewrites.

## Setup

```bash
git clone https://github.com/marquesantero/vorchestra.git
cd vorchestra
npm install
npm run tauri dev
```

## Pull request guidelines

- Branch from `main`.
- Keep PRs focused on one behavior, screen, command group or doc area.
- Include a short test plan.
- Add tests when changing parsers, package operations, background jobs or core state hooks.
- Include screenshots/GIFs for visible UI changes.
- Update `CHANGELOG.md` when behavior changes.

## Code style

Frontend:

- React functional components and hooks.
- Strict TypeScript.
- Avoid `any`; narrow untyped Tauri payloads at the boundary.
- Use shared visual utilities instead of ad hoc styles.
- Do not introduce native `alert`, `prompt`, or `confirm`.

Backend:

- Keep commands domain-oriented under `src-tauri/src/commands/`.
- Heavy work must not block the UI thread.
- Use background jobs for long-running or cancellable work.
- Do not pass user-controlled strings to a shell.
- Preserve Conda/Pixi read-only behavior unless mutation is intentionally designed and tested.
