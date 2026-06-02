# Diagnostics and security

Diagnostics and security checks are intentionally manual. They do not auto-run when opening the tab.

## Diagnostics

- Check Python and package manager consistency.
- Detect missing tools.
- Detect outdated packages.
- Adapt commands for `pip` or `uv` depending on manager type.
- Run heavy checks as cancellable background jobs.

## Security

- Run `pip-audit` when available.
- Show install actions when `pip-audit` is missing.
- Summarize vulnerabilities using PyPA advisories.
- Export CycloneDX SBOM.

## Package hygiene

Metadata hygiene checks include:

- License summary.
- Missing license queue.
- Deprecated or inactive package hints.
- Suspicious package names and typosquatting hints.
- Searchable/filterable review queue.
