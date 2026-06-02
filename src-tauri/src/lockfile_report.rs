//! Lockfile drift report construction.

use std::collections::{BTreeMap, HashMap};

use crate::types::{DriftEntry, DriftKind, DriftReport};

pub fn build_drift_report(
    lock_map: HashMap<String, String>,
    live_map: HashMap<String, String>,
    lockfile_path: String,
) -> DriftReport {
    let mut all_names: BTreeMap<String, ()> = BTreeMap::new();
    for k in lock_map.keys() {
        all_names.insert(k.clone(), ());
    }
    for k in live_map.keys() {
        all_names.insert(k.clone(), ());
    }

    let mut entries: Vec<DriftEntry> = Vec::with_capacity(all_names.len());
    let mut diff_count = 0usize;
    for (name, _) in all_names {
        let lv = lock_map.get(&name).cloned();
        let iv = live_map.get(&name).cloned();
        let kind = match (&lv, &iv) {
            (Some(l), Some(i)) if l == i => DriftKind::InSync,
            (Some(_), Some(_)) => DriftKind::DifferentVersion,
            (Some(_), None) => DriftKind::Missing,
            (None, Some(_)) => DriftKind::Extra,
            (None, None) => continue,
        };
        if kind != DriftKind::InSync {
            diff_count += 1;
        }
        entries.push(DriftEntry {
            name,
            lock_version: lv,
            installed_version: iv,
            kind,
        });
    }

    entries.sort_by(|a, b| {
        order_for(&a.kind)
            .cmp(&order_for(&b.kind))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    DriftReport {
        in_sync: diff_count == 0,
        diff_count,
        lockfile_path,
        entries,
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
    use crate::helpers::parse_pip_freeze;

    #[test]
    fn build_drift_report_orders_differences_before_synced_rows() {
        let lock_map = parse_pip_freeze(include_str!("../test-fixtures/lockfile_freeze.txt"));
        let live_map = parse_pip_freeze(include_str!("../test-fixtures/live_freeze.txt"));

        let report = build_drift_report(lock_map, live_map, "requirements.lock".to_string());

        assert!(!report.in_sync);
        assert_eq!(report.diff_count, 3);
        assert_eq!(report.entries[0].kind, DriftKind::DifferentVersion);
        assert_eq!(report.entries[0].name, "flask");
        assert_eq!(report.entries[1].kind, DriftKind::Missing);
        assert_eq!(report.entries[1].name, "uvicorn");
        assert_eq!(report.entries[2].kind, DriftKind::Extra);
        assert_eq!(report.entries[2].name, "rich");
        assert_eq!(report.entries[3].kind, DriftKind::InSync);
    }
}
