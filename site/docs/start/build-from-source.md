# Build from source

## Development window

```bash
npm install
npm run tauri dev
```

## Frontend-only development

```bash
npm run dev
```

## Production build

```bash
npm run tauri build
```

Published pre-release installers are available on GitHub Releases. Use source builds for local development, validation, and contribution work.

## Validation commands

Use targeted checks while developing:

```bash
npm run check:frontend
npm run test:frontend:product
npm run check:rust
npm run test:rust
```

Run the full check before large pushes:

```bash
npm run check
```

Rust-specific checks:

```bash
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets
```
