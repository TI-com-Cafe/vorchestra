# Diagnostics and security

Diagnostics and security checks are manual. They do not run automatically when opening the tab because they can call external tools, inspect many packages, or access advisory data.

## Diagnostics

Diagnostics help answer whether the environment is internally consistent.

Checks include:

- Package conflict check.
- Outdated package listing.
- Manager-specific command adaptation.
- Missing pip or helper tool hints.
- Native manager limitations.

Diagnostics run as cancellable background jobs and stream logs when external commands produce output.

## Security audit

Security audit uses `pip-audit` when available.

The audit can show:

- Vulnerable packages.
- Advisory identifiers.
- Installed versions.
- Fixed versions when advisory data provides them.
- Raw tool guidance when parsing fails.

If `pip-audit` is missing, VOrchestra shows an install command adapted to the selected manager.

For uv environments, VOrchestra may use uv tool execution or uv-targeted install guidance depending on the context.

## SBOM export

VOrchestra can export a CycloneDX SBOM for package inventory use cases. Use SBOM export when you need to share dependency composition for audit or support.

## Package metadata hygiene

Metadata hygiene checks look beyond known vulnerabilities.

Signals include:

- License summary.
- Missing or unclear license metadata.
- Deprecated or inactive package hints.
- Suspicious package names.
- Typosquatting-style hints.
- Root package versus dependency package ownership.

These signals are not automatic proof of a security issue. Treat them as review prompts.

## Recommended workflow

1. Run diagnostics.
2. Fix missing pip or missing helper tools first.
3. Run security audit.
4. Run metadata hygiene.
5. Export SBOM if you need an artifact.
6. Use Repair Wizard for guided fixes.
