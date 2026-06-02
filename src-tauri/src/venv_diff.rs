//! Package-level diff report construction for two virtual environments.

use std::collections::{BTreeMap, HashMap};

use crate::types::{DriftKind, VenvDiffEntry, VenvDiffReport};

pub fn build_venv_diff_report(
    source_path: String,
    target_path: String,
    source_pkgs: HashMap<String, String>,
    target_pkgs: HashMap<String, String>,
) -> VenvDiffReport {
    let mut all_names: BTreeMap<String, ()> = BTreeMap::new();
    for k in source_pkgs.keys() {
        all_names.insert(k.clone(), ());
    }
    for k in target_pkgs.keys() {
        all_names.insert(k.clone(), ());
    }

    let mut entries: Vec<VenvDiffEntry> = Vec::with_capacity(all_names.len());
    let mut matching = 0usize;
    let mut differing = 0usize;
    let mut only_in_source = 0usize;
    let mut only_in_target = 0usize;

    for (name, _) in all_names {
        let sv = source_pkgs.get(&name).cloned();
        let tv = target_pkgs.get(&name).cloned();
        let kind = match (&sv, &tv) {
            (Some(s), Some(t)) if s == t => {
                matching += 1;
                DriftKind::InSync
            }
            (Some(_), Some(_)) => {
                differing += 1;
                DriftKind::DifferentVersion
            }
            (Some(_), None) => {
                only_in_source += 1;
                DriftKind::Missing
            }
            (None, Some(_)) => {
                only_in_target += 1;
                DriftKind::Extra
            }
            (None, None) => continue,
        };
        entries.push(VenvDiffEntry {
            name,
            source_version: sv,
            target_version: tv,
            kind,
        });
    }

    entries.sort_by(|a, b| {
        order_for(&a.kind)
            .cmp(&order_for(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    VenvDiffReport {
        source_path,
        target_path,
        entries,
        matching,
        differing,
        only_in_source,
        only_in_target,
    }
}

fn order_for(kind: &DriftKind) -> u8 {
    match kind {
        DriftKind::DifferentVersion => 0,
        DriftKind::Missing => 1,
        DriftKind::Extra => 2,
        DriftKind::InSync => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ordered_diff_summary() {
        let source = HashMap::from([
            ("same".to_string(), "1.0".to_string()),
            ("old".to_string(), "1.0".to_string()),
            ("source-only".to_string(), "2.0".to_string()),
        ]);
        let target = HashMap::from([
            ("same".to_string(), "1.0".to_string()),
            ("old".to_string(), "1.1".to_string()),
            ("target-only".to_string(), "3.0".to_string()),
        ]);

        let report = build_venv_diff_report("src".into(), "dst".into(), source, target);

        assert_eq!(report.matching, 1);
        assert_eq!(report.differing, 1);
        assert_eq!(report.only_in_source, 1);
        assert_eq!(report.only_in_target, 1);
        assert_eq!(report.entries[0].name, "old");
        assert_eq!(report.entries[1].name, "source-only");
        assert_eq!(report.entries[2].name, "target-only");
        assert_eq!(report.entries[3].name, "same");
    }
}
