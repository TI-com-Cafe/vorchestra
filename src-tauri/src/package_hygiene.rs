//! Package hygiene report parsing and Python probe script.

use crate::types::PackageHygieneReport;

pub const PACKAGE_HYGIENE_SCRIPT: &str = r#"import importlib.metadata as m, json, re, sys
def norm(s):
    return re.sub(r"[-_.]+", "-", s).lower()

packages = {}
referenced = set()
for dist in m.distributions():
    name = dist.metadata.get("Name") or dist.metadata.get("name") or dist.name
    if not name:
        continue
    packages[norm(name)] = name
    for req in (dist.requires or []):
        base = req.split(";", 1)[0].strip()
        if not base:
            continue
        base = base.split("[", 1)[0].strip()
        match = re.match(r"([A-Za-z0-9_.-]+)", base)
        if match:
            referenced.add(norm(match.group(1)))

roots = sorted([name for key, name in packages.items() if key not in referenced], key=str.lower)
deps = sorted([name for key, name in packages.items() if key in referenced], key=str.lower)
sys.stdout.write(json.dumps({
    "root_packages": roots,
    "dependency_packages": deps,
    "total_packages": len(packages),
}))
"#;

pub fn parse_package_hygiene_report(raw: &str) -> Result<PackageHygieneReport, String> {
    serde_json::from_str(raw).map_err(|e| format!("Invalid JSON from python: {} ({})", e, raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_package_hygiene_report_accepts_root_and_dependency_sets() {
        let raw = include_str!("../test-fixtures/package_hygiene_report.json");

        let report = parse_package_hygiene_report(raw).expect("valid report");

        assert_eq!(report.total_packages, 4);
        assert_eq!(report.root_packages, vec!["fastapi", "pytest"]);
        assert_eq!(report.dependency_packages, vec!["anyio", "pydantic"]);
    }

    #[test]
    fn parse_package_hygiene_report_rejects_invalid_payloads() {
        let err = parse_package_hygiene_report(r#"{"root_packages": []}"#).unwrap_err();
        assert!(err.contains("Invalid JSON from python"));
    }
}
