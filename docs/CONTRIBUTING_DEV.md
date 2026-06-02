# Contributor Developer Notes

## Local Setup

Required:

- Node.js 20+
- Rust 1.85+
- Python 3.x
- npm

Recommended:

- `uv`
- `pipdeptree`
- `pip-audit`
- Docker
- VS Code CLI (`code`)

## Common Commands

```bash
npm install
npm run tauri dev
npm run check
npm run build
cd src-tauri && cargo test --all-targets
```

## Working Principles

- Preserve local-first behavior.
- Keep expensive work in background jobs.
- Add parser fixtures for new parser behavior.
- Keep Dependabot updates conservative until cross-platform Tauri compatibility is proven.
