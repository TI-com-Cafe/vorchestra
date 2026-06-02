#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-health}"
PYTHON_BIN="${PYTHON_BIN:-python}"
REQUIREMENTS_FILE="${REQUIREMENTS_FILE:-}"

log() { printf '[vorchestra] %s\n' "$*"; }
run_if_available() {
  local module="$1"
  shift
  if "$PYTHON_BIN" -c "import ${module}" >/dev/null 2>&1; then
    "$PYTHON_BIN" -m "$module" "$@"
  else
    log "${module} is not installed; skipping."
  fi
}

log "python: $($PYTHON_BIN --version 2>&1)"

if [[ -n "$REQUIREMENTS_FILE" && -f "$REQUIREMENTS_FILE" ]]; then
  log "installing requirements from ${REQUIREMENTS_FILE}"
  "$PYTHON_BIN" -m pip install -r "$REQUIREMENTS_FILE"
fi

case "$MODE" in
  health)
    log "running pip check"
    "$PYTHON_BIN" -m pip check
    ;;
  security)
    log "running pip check"
    "$PYTHON_BIN" -m pip check
    log "running pip-audit when available"
    run_if_available pip_audit --format json
    ;;
  metadata)
    log "running package metadata summary"
    "$PYTHON_BIN" - <<'PY'
import importlib.metadata as metadata
missing = []
licenses = {}
for dist in metadata.distributions():
    name = dist.metadata.get('Name') or dist.name
    license_value = (dist.metadata.get('License') or '').strip()
    if not license_value or license_value.lower() in {'unknown', 'none', 'license'}:
        missing.append(name)
    else:
        licenses[license_value] = licenses.get(license_value, 0) + 1
print(f'packages={len(list(metadata.distributions()))}')
print(f'missing_license={len(missing)}')
for license_value, count in sorted(licenses.items(), key=lambda item: (-item[1], item[0]))[:10]:
    print(f'license={license_value} count={count}')
PY
    ;;
  all)
    "$0" health
    "$0" security
    "$0" metadata
    ;;
  *)
    echo "Usage: $0 [health|security|metadata|all]" >&2
    exit 2
    ;;
esac
