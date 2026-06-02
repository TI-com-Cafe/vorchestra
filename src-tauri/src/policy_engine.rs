//! Project policy evaluation for package governance.
//!
//! Policies are optional and project-local. A missing `vorchestra.toml`
//! means VOrchestra stays permissive. When present, policy findings can
//! warn or block package operations and annotate diagnostics.

use crate::types::{
    DeprecatedPackage, PolicyAction, PolicyDecision, PolicyFinding, SuspiciousPackage,
};
use serde::Deserialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const POLICY_FILE: &str = "vorchestra.toml";

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PolicyConfig {
    pub policy: PolicySection,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default)]
pub struct PolicySection {
    pub critical_vulnerabilities: PolicyAction,
    pub unknown_license: PolicyAction,
    pub suspicious_packages: PolicyAction,
    pub deprecated_packages: PolicyAction,
    pub licenses: LicensePolicy,
    pub packages: PackagePolicy,
}

impl Default for PolicySection {
    fn default() -> Self {
        Self {
            critical_vulnerabilities: PolicyAction::Warn,
            unknown_license: PolicyAction::Warn,
            suspicious_packages: PolicyAction::Warn,
            deprecated_packages: PolicyAction::Warn,
            licenses: LicensePolicy::default(),
            packages: PackagePolicy::default(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct LicensePolicy {
    pub deny: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct PackagePolicy {
    pub deny: Vec<String>,
}

impl<'de> Deserialize<'de> for PolicyAction {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.trim().to_ascii_lowercase().as_str() {
            "off" | "ignore" | "disabled" => Ok(PolicyAction::Off),
            "warn" | "warning" => Ok(PolicyAction::Warn),
            "block" | "deny" | "error" => Ok(PolicyAction::Block),
            other => Err(serde::de::Error::custom(format!(
                "invalid policy action `{}`; use off, warn or block",
                other
            ))),
        }
    }
}

pub fn project_root_from_venv(venv: &Path) -> PathBuf {
    venv.parent().unwrap_or(venv).to_path_buf()
}

pub fn load_policy_for_project(
    project_root: &Path,
) -> Result<Option<(PolicyConfig, PathBuf)>, String> {
    let path = project_root.join(POLICY_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let config: PolicyConfig =
        toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
    Ok(Some((config, path)))
}

pub fn empty_decision(config_path: Option<&Path>) -> PolicyDecision {
    PolicyDecision {
        enabled: config_path.is_some(),
        allowed: true,
        config_path: config_path.map(|p| p.to_string_lossy().to_string()),
        findings: Vec::new(),
    }
}

pub fn evaluate_install_policy_for_venv(
    venv: &Path,
    package_spec: &str,
) -> Result<PolicyDecision, String> {
    let root = project_root_from_venv(venv);
    let Some((config, path)) = load_policy_for_project(&root)? else {
        return Ok(empty_decision(None));
    };
    Ok(evaluate_package_name(
        &config,
        Some(&path),
        &package_name_from_spec(package_spec),
    ))
}

pub fn evaluate_package_name(
    config: &PolicyConfig,
    config_path: Option<&Path>,
    package_name: &str,
) -> PolicyDecision {
    let mut decision = empty_decision(config_path);
    let base_name = package_name_from_spec(package_name);
    let normalized = normalize_name(&base_name);
    let deny = normalized_set(&config.policy.packages.deny);
    if deny.contains(&normalized) {
        push_finding(
            &mut decision,
            PolicyAction::Block,
            "package_denylist",
            Some(&base_name),
            format!("Package `{}` is denied by project policy.", base_name),
            None,
        );
    }

    if let Some(reason) = suspicious_package_reason(&base_name) {
        push_finding(
            &mut decision,
            config.policy.suspicious_packages.clone(),
            "suspicious_package_name",
            Some(&base_name),
            format!("Package `{}` needs supply-chain review.", base_name),
            Some(reason),
        );
    }
    decision
}

pub fn evaluate_metadata_policy(
    config: &PolicyConfig,
    config_path: Option<&Path>,
    missing_license: &[String],
    licenses: &[(String, usize)],
    suspicious: &[SuspiciousPackage],
    deprecated: &[DeprecatedPackage],
) -> PolicyDecision {
    let mut decision = empty_decision(config_path);
    for name in missing_license {
        push_finding(
            &mut decision,
            config.policy.unknown_license.clone(),
            "unknown_license",
            Some(name),
            format!("Package `{}` has no license metadata.", name),
            Some("Installed metadata did not expose a reliable license.".to_string()),
        );
    }

    let denied_licenses = normalized_set(&config.policy.licenses.deny);
    for (license, count) in licenses {
        let normalized_license = license.to_ascii_lowercase();
        if denied_licenses
            .iter()
            .any(|denied| normalized_license.contains(denied))
        {
            push_finding(
                &mut decision,
                PolicyAction::Block,
                "denied_license",
                None,
                format!(
                    "Denied license `{}` appears in {} package(s).",
                    license, count
                ),
                Some("Configure [policy.licenses].deny to control this rule.".to_string()),
            );
        }
    }

    for pkg in suspicious {
        push_finding(
            &mut decision,
            config.policy.suspicious_packages.clone(),
            "suspicious_package_name",
            Some(&pkg.name),
            format!("Package `{}` needs supply-chain review.", pkg.name),
            Some(pkg.reason.clone()),
        );
    }

    for pkg in deprecated {
        push_finding(
            &mut decision,
            config.policy.deprecated_packages.clone(),
            "deprecated_package",
            Some(&pkg.name),
            format!("Package `{}` is deprecated or inactive.", pkg.name),
            Some(pkg.reason.clone()),
        );
    }
    decision
}

pub fn evaluate_security_policy(
    config: &PolicyConfig,
    config_path: Option<&Path>,
    report: &serde_json::Value,
) -> PolicyDecision {
    let mut decision = empty_decision(config_path);
    let Some(deps) = report.get("dependencies").and_then(|v| v.as_array()) else {
        return decision;
    };
    for dep in deps {
        let package = dep
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let vulnerabilities = dep
            .get("vulnerabilities")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for vuln in vulnerabilities {
            if vulnerability_is_critical(&vuln) {
                let id = vuln
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown advisory");
                push_finding(
                    &mut decision,
                    config.policy.critical_vulnerabilities.clone(),
                    "critical_vulnerability",
                    Some(package),
                    format!("Critical vulnerability `{}` affects `{}`.", id, package),
                    extract_severity_evidence(&vuln),
                );
            }
        }
    }
    decision
}

pub fn attach_policy_to_security_report(
    project_root: &Path,
    mut report: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let Some((config, path)) = load_policy_for_project(project_root)? else {
        report["_vorchestra_policy"] =
            serde_json::to_value(empty_decision(None)).map_err(|e| e.to_string())?;
        return Ok(report);
    };
    let policy = evaluate_security_policy(&config, Some(&path), &report);
    report["_vorchestra_policy"] = serde_json::to_value(policy).map_err(|e| e.to_string())?;
    Ok(report)
}

fn push_finding(
    decision: &mut PolicyDecision,
    action: PolicyAction,
    code: &str,
    package_name: Option<&str>,
    message: String,
    evidence: Option<String>,
) {
    if action == PolicyAction::Off {
        return;
    }
    if action == PolicyAction::Block {
        decision.allowed = false;
    }
    decision.findings.push(PolicyFinding {
        severity: match action {
            PolicyAction::Off => "info",
            PolicyAction::Warn => "warning",
            PolicyAction::Block => "block",
        }
        .to_string(),
        code: code.to_string(),
        package_name: package_name.map(str::to_string),
        message,
        evidence,
    });
}

fn normalized_set(values: &[String]) -> BTreeSet<String> {
    values.iter().map(|value| normalize_name(value)).collect()
}

fn normalize_name(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace(['_', '.', '-'], "")
}

fn package_name_from_spec(spec: &str) -> String {
    let trimmed = spec.trim();
    if trimmed.starts_with("git+") || trimmed.contains('/') || trimmed.contains('\\') {
        return trimmed.to_string();
    }
    trimmed
        .split_once('[')
        .map(|(name, _)| name)
        .unwrap_or(trimmed)
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-' && c != '.')
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

fn suspicious_package_reason(name: &str) -> Option<String> {
    let normalized = normalize_name(name);
    let common_typos = [
        ("reqeusts", "requests"),
        ("requsts", "requests"),
        ("numpi", "numpy"),
        ("nunpy", "numpy"),
        ("pandaz", "pandas"),
        ("panda", "pandas"),
        ("djangoo", "django"),
        ("djagno", "django"),
        ("flaks", "flask"),
        ("fastapii", "fastapi"),
        ("pytoch", "torch"),
        ("pytroch", "torch"),
        ("tensorfow", "tensorflow"),
        ("beatifulsoup4", "beautifulsoup4"),
        ("beautifulsoup", "beautifulsoup4"),
    ];
    for (typo, expected) in common_typos {
        if normalized == typo {
            return Some(format!(
                "Name resembles the popular package `{}`.",
                expected
            ));
        }
    }
    if normalized.contains("official") || normalized.contains("verified") {
        return Some("Name uses trust-marketing words such as official/verified.".to_string());
    }
    if normalized.starts_with("python") && normalized.len() > "python".len() {
        return Some(
            "Name starts with `python`, which is a common impersonation pattern.".to_string(),
        );
    }
    None
}

fn vulnerability_is_critical(vuln: &serde_json::Value) -> bool {
    let haystack = [
        vuln.get("severity"),
        vuln.get("severity_level"),
        vuln.get("cvss_severity"),
        vuln.get("database_specific")
            .and_then(|v| v.get("severity")),
    ]
    .into_iter()
    .flatten()
    .filter_map(|v| v.as_str())
    .collect::<Vec<_>>()
    .join(" ")
    .to_ascii_lowercase();
    haystack.contains("critical")
}

fn extract_severity_evidence(vuln: &serde_json::Value) -> Option<String> {
    for key in ["severity", "severity_level", "cvss_severity"] {
        if let Some(value) = vuln.get(key).and_then(|v| v.as_str()) {
            return Some(format!("{}={}", key, value));
        }
    }
    vuln.get("database_specific")
        .and_then(|v| v.get("severity"))
        .and_then(|v| v.as_str())
        .map(|value| format!("database_specific.severity={}", value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_policy(policy: PolicySection) -> PolicyConfig {
        PolicyConfig { policy }
    }

    #[test]
    fn missing_config_decision_is_disabled_and_allowed() {
        let decision = empty_decision(None);
        assert!(!decision.enabled);
        assert!(decision.allowed);
        assert!(decision.findings.is_empty());
    }

    #[test]
    fn package_denylist_blocks_install() {
        let mut policy = PolicySection::default();
        policy.packages.deny = vec!["requests".to_string()];
        let decision = evaluate_package_name(&config_with_policy(policy), None, "requests==2.32.0");
        assert!(!decision.allowed);
        assert_eq!(decision.findings[0].code, "package_denylist");
    }

    #[test]
    fn suspicious_package_respects_warn_action() {
        let policy = PolicySection {
            suspicious_packages: PolicyAction::Warn,
            ..PolicySection::default()
        };
        let decision = evaluate_package_name(&config_with_policy(policy), None, "reqeusts");
        assert!(decision.allowed);
        assert_eq!(decision.findings[0].severity, "warning");
    }

    #[test]
    fn metadata_policy_blocks_denied_license_and_warns_missing_license() {
        let mut policy = PolicySection::default();
        policy.licenses.deny = vec!["gpl".to_string()];
        let decision = evaluate_metadata_policy(
            &config_with_policy(policy),
            None,
            &["private-lib".to_string()],
            &[("GPL-3.0".to_string(), 1)],
            &[],
            &[],
        );
        assert!(!decision.allowed);
        assert!(decision
            .findings
            .iter()
            .any(|f| f.code == "unknown_license"));
        assert!(decision.findings.iter().any(|f| f.code == "denied_license"));
    }

    #[test]
    fn critical_security_policy_can_block() {
        let policy = PolicySection {
            critical_vulnerabilities: PolicyAction::Block,
            ..PolicySection::default()
        };
        let report = serde_json::json!({
            "dependencies": [{
                "name": "django",
                "vulnerabilities": [{
                    "id": "PYSEC-1",
                    "severity": "CRITICAL"
                }]
            }]
        });
        let decision = evaluate_security_policy(&config_with_policy(policy), None, &report);
        assert!(!decision.allowed);
        assert_eq!(decision.findings[0].code, "critical_vulnerability");
    }

    #[test]
    fn toml_policy_parses_actions_and_lists() {
        let raw = r#"
[policy]
critical_vulnerabilities = "block"
suspicious_packages = "warn"

[policy.licenses]
deny = ["GPL", "AGPL"]

[policy.packages]
deny = ["badpkg"]
"#;
        let parsed: PolicyConfig = toml::from_str(raw).unwrap();
        assert_eq!(parsed.policy.critical_vulnerabilities, PolicyAction::Block);
        assert_eq!(parsed.policy.licenses.deny, vec!["GPL", "AGPL"]);
        assert_eq!(parsed.policy.packages.deny, vec!["badpkg"]);
    }
}
