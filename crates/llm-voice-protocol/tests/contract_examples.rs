//! Rejoue `contracts/core-v1/examples/manifest.json` : chaque exemple doit
//! être accepté ou rejeté par `llm_voice_protocol::deserialize_and_validate`
//! exactement comme l'annonce le manifeste — le même manifeste et les mêmes
//! fichiers que le test vitest (`ajv`) côté extension
//! (`vscode-extension/test/unit/contracts/core-v1.contract.test.ts`). Une
//! divergence entre les deux tests est un bug de contrat.

use std::collections::HashSet;
use std::fs;

use llm_voice_protocol::{deserialize_and_validate, examples_root};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct ManifestEntry {
    file: String,
    kind: String,
    valid: bool,
    #[serde(default)]
    #[allow(dead_code)]
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    examples: Vec<ManifestEntry>,
}

fn load_manifest() -> Manifest {
    let path = examples_root().join("manifest.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("lecture de {} impossible : {e}", path.display()));
    serde_json::from_str(&raw).expect("manifest.json mal formé")
}

const KNOWN_KINDS: &[&str] = &[
    "http/health.response",
    "http/enqueue.request",
    "http/play.request",
    "http/pause.request",
    "http/resume.request",
    "http/stop.request",
    "http/seek.request",
    "http/ack.response",
    "ws/state.event",
    "ws/position.event",
    "ws/segment_started.event",
    "ws/segment_ended.event",
    "ws/underrun.event",
    "ws/ended.event",
    "ws/error.event",
];

#[test]
fn manifest_covers_every_kind_with_a_valid_and_an_invalid_example() {
    let manifest = load_manifest();
    for kind in KNOWN_KINDS {
        let entries: Vec<&ManifestEntry> = manifest
            .examples
            .iter()
            .filter(|e| e.kind == *kind)
            .collect();
        assert!(
            entries.iter().any(|e| e.valid),
            "{kind}: aucun exemple valide dans le manifeste"
        );
        assert!(
            entries.iter().any(|e| !e.valid),
            "{kind}: aucun exemple invalide dans le manifeste"
        );
    }

    let manifest_kinds: HashSet<&str> = manifest.examples.iter().map(|e| e.kind.as_str()).collect();
    for kind in &manifest_kinds {
        assert!(
            KNOWN_KINDS.contains(kind),
            "manifest.json référence un kind sans struct Rust : \"{kind}\""
        );
    }
}

#[test]
fn every_example_is_accepted_or_rejected_as_the_manifest_says() {
    let manifest = load_manifest();
    assert!(!manifest.examples.is_empty(), "manifest.json est vide");

    let mut failures = Vec::new();
    for entry in &manifest.examples {
        let path = examples_root().join(&entry.file);
        let json = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("lecture de {} impossible : {e}", path.display()));

        let result = deserialize_and_validate(&entry.kind, &json);
        let accepted = result.is_ok();

        if accepted != entry.valid {
            let detail = match &result {
                Ok(()) => "accepté à tort".to_string(),
                Err(e) => format!("rejeté à tort : {e}"),
            };
            failures.push(format!(
                "{} ({}) : attendu valid={}, obtenu valid={} — {}",
                entry.file, entry.kind, entry.valid, accepted, detail
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} exemple(s) en désaccord avec le manifeste :\n{}",
        failures.len(),
        failures.join("\n")
    );
}
