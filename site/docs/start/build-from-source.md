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

The release workflow is scaffolded, but binary releases have not been published yet.

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
