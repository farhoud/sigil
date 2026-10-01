//! Stored interpretations, so a request asks only for what is stale.
//!
//! Presenting a source's whole resolved closure is what lets a claim in one
//! component reach a flow graph in a component it depends on. It also means the
//! same dependency Facets are handed over once per dependent: projecting
//! `packages/core/src/pipeline.sigil` grows from 16 Facets to 441, and across a
//! workspace the shared ones are re-read many times over. This module removes
//! that repetition, which is the whole of the widening's cost.
//!
//! Nothing here launches a model. A stored interpretation is one a caller
//! already supplied; reusing it is reuse of their own input, not a new call.
use super::{
    dialect::Row,
    prepare::{REQUEST_FORMAT, Request},
};
use crate::sources::hash;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Where stored interpretations live, under the path this component owns.
const DIR: &str = ".sigil/claims/interpretations";

/// One thing the interpreter is shown, and the unit staleness is judged in.
///
/// Not always a Facet. Logic is presented as a whole section, because a flow
/// spans one, so a Logic unit is the section and its key covers every Facet's
/// prose in it: edit one Logic paragraph and the section is re-read, because
/// the flow through it may have changed. Every other role is presented one
/// Facet at a time. Facet IDs are saved beside each unit's rows, so an unchanged
/// unit can remap rows after its source offsets move.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    pub key: String,
    pub source: String,
    pub component: String,
    pub section: String,
    /// Every Facet this unit covers, in source order.
    pub facets: Vec<String>,
}

/// The presentation units of a request, each with the key it is stored under.
///
/// The key deliberately excludes the binding. A binding is taken over the whole
/// export digest, so any edit anywhere in a 15-source closure moves it; keying
/// on it would empty the store on every run, which is the cost this module
/// exists to remove. It also excludes the closure: grounding runs at admission
/// rather than at interpretation, so adding an import re-grounds stored rows
/// without re-reading them.
///
/// It includes the source, owning component, and contract role because prose
/// alone does not identify a unit. Two Facets can carry byte-identical prose,
/// and grounding is checked against each one's own component and references.
/// The saved Facet IDs are remapped only within an unchanged unit before
/// admission rechecks its rows against the current references.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn units(request: &Request) -> Vec<Unit> {
    let prose: BTreeMap<&str, &str> = request
        .rows
        .iter()
        .map(|r| (r.facet.as_str(), r.prose.as_str()))
        .collect();
    let identity = (
        REQUEST_FORMAT,
        request.binding.guidance_fingerprint.as_str(),
        request.binding.vocabulary_generation,
    );

    let mut units = Vec::new();
    let mut grouped: Vec<&str> = Vec::new();
    for flow in &request.flows {
        let body: Vec<&str> = flow
            .facets
            .iter()
            .map(|f| prose.get(f.as_str()).copied().unwrap_or_default())
            .collect();
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&(
                    "sigil-claims-memo-v3",
                    identity,
                    &flow.source,
                    &flow.component,
                    "logic",
                    &body,
                ))
                .expect("memo key serialization"),
            ),
            source: flow.source.clone(),
            component: flow.component.clone(),
            section: "logic".to_owned(),
            facets: flow.facets.clone(),
        });
        grouped.extend(flow.facets.iter().map(String::as_str));
    }

    let mut duplicate_occurrences = BTreeMap::<(&str, &str, &str, &str), usize>::new();
    for row in &request.rows {
        if grouped.contains(&row.facet.as_str()) {
            continue; // carried by its section's unit
        }
        let occurrence = duplicate_occurrences
            .entry((&row.source, &row.component, &row.section, &row.prose))
            .or_default();
        let discriminator = *occurrence;
        *occurrence += 1;
        units.push(Unit {
            key: hash(
                &serde_json::to_vec(&(
                    "sigil-claims-memo-v3",
                    identity,
                    &row.source,
                    &row.component,
                    &row.section,
                    &[row.prose.as_str()],
                    discriminator,
                ))
                .expect("memo key serialization"),
            ),
            source: row.source.clone(),
            component: row.component.clone(),
            section: row.section.clone(),
            facets: vec![row.facet.clone()],
        });
    }
    units
}

fn path(root: &Path, key: &str) -> PathBuf {
    root.join(DIR).join(format!("{key}.json"))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stored {
    facets: Vec<String>,
    rows: Vec<Row>,
}

/// The rows stored for a unit, remapped to its current Facet IDs, or `None` when
/// the saved identities do not match the unchanged unit.
pub fn load(root: &Path, unit: &Unit) -> Option<Vec<Row>> {
    let bytes = std::fs::read(path(root, &unit.key)).ok()?;
    let stored: Stored = serde_json::from_slice(&bytes).ok()?;
    if stored.facets.len() != unit.facets.len()
        || stored.facets.iter().collect::<BTreeSet<_>>().len() != stored.facets.len()
        || unit.facets.iter().collect::<BTreeSet<_>>().len() != unit.facets.len()
    {
        return None;
    }
    let identities: BTreeMap<String, String> = stored
        .facets
        .into_iter()
        .zip(unit.facets.iter().cloned())
        .collect();
    stored
        .rows
        .into_iter()
        .map(|mut row| {
            let facet = identities.get(row.facet())?.clone();
            match &mut row {
                Row::Claim { facet: current, .. }
                | Row::Property { facet: current, .. }
                | Row::Measure { facet: current, .. }
                | Row::Reading { facet: current, .. }
                | Row::Step { facet: current, .. }
                | Row::Guard { facet: current, .. } => *current = facet,
            }
            Some(row)
        })
        .collect()
}

/// Store the rows a caller supplied for one unit and the Facet IDs they name.
///
/// Writes under this component's own path and never the compiler's world cache,
/// which the contract makes read-only here.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn save(root: &Path, unit: &Unit, rows: &[Row]) -> Result<(), String> {
    let path = path(root, &unit.key);
    let dir = path.parent().expect("memo path has a parent");
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut bytes = serde_json::to_vec(&Stored {
        facets: unit.facets.clone(),
        rows: rows.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// Split a request's units into those a caller must interpret and those stored.
pub fn split(request: &Request, root: &Path) -> (Vec<Unit>, Vec<(Unit, Vec<Row>)>) {
    let mut stale = Vec::new();
    let mut reused = Vec::new();
    for unit in units(request) {
        match load(root, &unit) {
            Some(rows) => reused.push((unit, rows)),
            None => stale.push(unit),
        }
    }
    (stale, reused)
}
