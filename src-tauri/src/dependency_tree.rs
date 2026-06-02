//! Dependency tree generation and JSON validation.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use crate::helpers::{
    get_python_path, new_command, run_command_with_timeout, run_command_with_timeout_and_cancel,
    stdout_or_stderr,
};

fn build_dependency_tree_with_python_internal(
    venv: &Path,
    cancel: Option<&AtomicBool>,
) -> Result<serde_json::Value, String> {
    let python = get_python_path(venv);
    let script = r#"import json, re, importlib.metadata as m

def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()

packages = {}
deps = {}

for dist in m.distributions():
    name = dist.metadata.get("Name") or dist.metadata.get("name") or dist.name
    if not name:
        continue
    key = norm(name)
    packages[key] = {"name": name, "version": dist.version or "unknown"}
    requires = []
    for req in (dist.requires or []):
        base = req.split(";", 1)[0].strip()
        if not base:
            continue
        base = base.split("[", 1)[0].strip()
        match = re.match(r"([A-Za-z0-9_.-]+)", base)
        if match:
            requires.append(norm(match.group(1)))
    deps[key] = requires

referenced = set()
for children in deps.values():
    for child in children:
        if child in packages:
            referenced.add(child)

roots = sorted([k for k in packages.keys() if k not in referenced])
if not roots:
    roots = sorted(packages.keys())

def build(node_key: str, stack):
    info = packages[node_key]
    if node_key in stack:
        return {"package_name": info["name"], "installed_version": info["version"], "dependencies": []}

    next_stack = set(stack)
    next_stack.add(node_key)

    children = []
    for dep_key in deps.get(node_key, []):
        if dep_key in packages:
            children.append(build(dep_key, next_stack))
    children.sort(key=lambda x: (x.get("package_name") or "").lower())

    return {
        "package_name": info["name"],
        "installed_version": info["version"],
        "dependencies": children,
    }

tree = [build(root, set()) for root in roots]
print(json.dumps(tree))
"#;
    let mut cmd = new_command(python);
    cmd.args(["-c", script]);
    let out = if let Some(cancel) = cancel {
        run_command_with_timeout_and_cancel(&mut cmd, 180, cancel)?
    } else {
        run_command_with_timeout(&mut cmd, 180)?
    };
    if out.status.success() {
        parse_dependency_tree_json(&out.stdout)
    } else {
        Err(format!(
            "Failed to build dependency tree: {}",
            stdout_or_stderr(&out).trim()
        ))
    }
}

pub fn build_dependency_tree_with_python_and_cancel(
    venv: &Path,
    cancel: &AtomicBool,
) -> Result<serde_json::Value, String> {
    build_dependency_tree_with_python_internal(venv, Some(cancel))
}

pub fn parse_dependency_tree_json(raw: &[u8]) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    let nodes = value
        .as_array()
        .ok_or_else(|| "Dependency tree must be a JSON array".to_string())?;
    for node in nodes {
        validate_dependency_tree_node(node)?;
    }
    Ok(value)
}

fn validate_dependency_tree_node(node: &serde_json::Value) -> Result<(), String> {
    let obj = node
        .as_object()
        .ok_or_else(|| "Dependency tree node must be an object".to_string())?;
    if !obj
        .get("package_name")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
    {
        return Err("Dependency tree node is missing package_name".to_string());
    }
    if !obj
        .get("installed_version")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
    {
        return Err("Dependency tree node is missing installed_version".to_string());
    }
    let deps = obj
        .get("dependencies")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Dependency tree node is missing dependencies".to_string())?;
    for child in deps {
        validate_dependency_tree_node(child)?;
    }
    Ok(())
}
