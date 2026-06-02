# Security Policy

## Supported Versions

VOrchestra is currently in pre-release. Security fixes target the latest `main` branch and the most recent tagged release.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report privately via one of:

1. **GitHub Private Vulnerability Reporting** — preferred. Open the *Security* tab of the repository and click "Report a vulnerability".
2. **Email** — send details to the project maintainer (see the GitHub profile).

Include:
- Affected version / commit.
- Reproduction steps or proof-of-concept.
- Impact assessment (what an attacker can do).
- Suggested mitigation, if known.

We aim to acknowledge reports within **72 hours** and to provide a fix or mitigation timeline within **7 days** for confirmed issues.

## Scope

In scope:
- Path traversal or arbitrary file write via Tauri commands.
- Command injection via env-handling, terminal-launch, or package-install paths.
- SQL injection via the local SQLite layer.
- Privilege escalation via the bundled binary.
- Tampering with downloaded packages (PyPI lookup path).

Out of scope:
- Vulnerabilities in third-party packages a user installs *into* their venvs (those are reported to the upstream package).
- Issues that require pre-existing root/admin access on the host.
- Social engineering of the maintainer.

## Disclosure

Once a fix is released, the advisory will be published via GitHub Security Advisories. Reporters are credited unless they request otherwise.
