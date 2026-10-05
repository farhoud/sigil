//! Project a design export into an interpretation request.
//!
//! Everything the external interpreter needs travels through here: the exact
//! prose of each Facet, the guidance bundle, and an immutable binding that lets
//! ingest refuse a mismatched pair. No `.sigil` file is read — the export
//! already carries every source's full text.
use super::{guidance, identity, vocabulary};
use crate::{
    frontend::{DesignInput, ImportStatus, SelectionStatus, Unit},
    scope, sources,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

/// Changes when the request or binding layout becomes incompatible.
///
/// 2 adds the Logic grouping: a flow spans a component's whole Logic section,
/// so a request that presents those Facets only one at a time cannot express
/// one. 3 widens presentation from the selected source to its whole resolved
/// closure, so a claim in one component can be checked against a flow graph in
/// a component it depends on. 4 adds `imports`: for each source in the closure,
/// the components it imports from and the Tag names it takes. The entity list
/// spans the whole closure, so without `imports` an interpreter cannot tell a
/// component a source imports from one it merely shares a closure with. A
/// directory prepared under an earlier format lacks the field or carries a
/// narrower Facet set and must be re-prepared. 5 presents the request as an
/// interpretation brief and gives every Facet a handle a returned row may name
/// it by; the brief's layout is not fingerprinted, so the format is what tells
/// an older directory apart.
pub const REQUEST_FORMAT: u32 = 5;

/// One Facet handed to the interpreter.
///
/// The contract role is present so the interpreter knows what kind of claim the
/// Facet can support, but it is not a column of any row that comes back: the
/// tool fills that from the export when it re-emits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FacetRow {
    /// The Facet's identity. A returned row may name it, and ingest records it.
    pub facet: String,
    /// The short name the brief shows, which a returned row may use instead of
    /// the identity. Handles run `f1`, `f2`, … across the whole closure in
    /// source order, so the closure alone fixes them: ingest rebuilds this
    /// request from the export and must arrive at the same numbering even when
    /// the stored interpretations changed in between.
    pub handle: String,
    pub component: String,
    pub component_label: String,
    pub section: String,
    pub source: String,
    pub prose: String,
}

/// An entity a claim from this design may name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdmissibleEntity {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub owner: Option<String>,
    pub source: String,
}

/// One component a source imports from, with the Tag names it takes.
///
/// Only a resolved import enters here, and only the names that resolved. A claim
/// may name a component only when the Facet's own component or the Facet's
/// source imports from it, so this is the list an interpreter checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedFrom {
    pub component: String,
    pub component_label: String,
    pub names: Vec<String>,
}

/// The components one source imports from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceImports {
    pub source: String,
    pub from: Vec<ImportedFrom>,
}

/// What ingest checks before it trusts a returned artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub format: u32,
    pub source: String,
    pub export_digest: String,
    pub guidance_fingerprint: String,
    pub vocabulary_generation: u32,
    /// Every source in the selected source's resolved closure, including itself.
    pub closure: Vec<String>,
    /// The Facets this request asked about, which bounds what may come back.
    pub facets: Vec<String>,
}

impl Binding {
    pub fn digest(&self) -> String {
        sources::hash(
            &serde_json::to_vec(&("sigil-claims-binding-v1", self)).expect("binding serialization"),
        )
    }
}

/// One component's Logic section, named as a whole.
///
/// A flow spans a section rather than a Facet, because a Facet is a paragraph:
/// the flow in `packages/core/src/pipeline.sigil` runs through three of its five
/// Logic Facets. An interpreter shown those Facets one at a time cannot express
/// an edge between them, so the section is named here and its Facets listed in
/// source order.
///
/// This carries no prose. Each Facet keeps its own row in `rows`, with its own
/// identity and prose slice, exactly as every other role does; the grouping adds
/// membership and order, and takes nothing away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogicSection {
    pub component: String,
    pub component_label: String,
    pub source: String,
    /// The section's Facet identities in source order. A step's ordinal runs
    /// across this whole list, which is what lets an edge cross from one Facet
    /// to another.
    pub facets: Vec<String>,
}

/// A prepared interpretation request, before it reaches disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub binding: Binding,
    pub rows: Vec<FacetRow>,
    /// One entry per component that declares a Logic section, in component
    /// order. A component without one appears nowhere here rather than as an
    /// empty group.
    pub flows: Vec<LogicSection>,
    pub entities: Vec<AdmissibleEntity>,
    /// Per source in the closure, the components it imports from. A source that
    /// imports nothing appears nowhere here rather than as an empty entry.
    pub imports: Vec<SourceImports>,
    /// Contract roles that declare at least one Facet, as `component\tsection`
    /// pairs. This is the denominator for whether an interpretation covered the
    /// design, so it is recorded at preparation rather than recomputed later.
    pub declared: Vec<(String, String)>,
}

/// The same request, presenting only the units named.
///
/// The binding is copied whole rather than narrowed. Ingest recomputes the
/// request from the export and compares bindings, so a narrowed binding would
/// make every prepared directory fail its own check. What narrows is what the
/// interpreter is shown; what it may return is unchanged, and a row it sends
/// back for a unit that was not asked for is a second interpretation of that
/// unit rather than an error.
pub fn presenting(request: &Request, units: &[super::memo::Unit]) -> Request {
    let asked: BTreeSet<&str> = units
        .iter()
        .flat_map(|u| u.facets.iter().map(String::as_str))
        .collect();
    Request {
        binding: request.binding.clone(),
        rows: request
            .rows
            .iter()
            .filter(|r| asked.contains(r.facet.as_str()))
            .cloned()
            .collect(),
        flows: request
            .flows
            .iter()
            .filter(|f| f.facets.iter().any(|x| asked.contains(x.as_str())))
            .cloned()
            .collect(),
        entities: request.entities.clone(),
        imports: request.imports.clone(),
        declared: request.declared.clone(),
    }
}

/// Digest of the whole export, so ingest can tell it was handed the same one.
pub fn export_digest(input: &DesignInput) -> String {
    sources::hash(
        &serde_json::to_vec(&("sigil-claims-export-v1", input)).expect("export serialization"),
    )
}

/// Build the request for one design source and its resolved closure.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn project(input: &DesignInput, source: &str) -> Result<Request, String> {
    if !input.sources.iter().any(|s| s.path == source) {
        return Err(format!("design source not exported: {source}"));
    }
    let closure = scope::design_membership(input, [source]).sources;

    let mut rows = Vec::new();
    // Coverage stays the selected source's. `declared` is the denominator for
    // the uninterpreted-section finding, so widening it with the closure would
    // turn one run's 16 Facets of coverage into 441 and report roughly 400 gaps
    // that are not this source's business. The closure is context, not scope.
    let mut declared = BTreeSet::new();
    // Logic Facets, keyed by component, in the order the prose is authored.
    // Ordered by the unit's byte offset rather than by Facet identity: an
    // identity embeds that offset as text, so sorting identities puts offset
    // 1000 before 999.
    let mut flows: BTreeMap<(String, String, String), Vec<(usize, String)>> = BTreeMap::new();
    let mut placed = Vec::new();
    for unit in input.units.iter().filter(|u| closure.contains(&u.source)) {
        let Some(row) = facet_row(input, unit)? else {
            continue;
        };
        if row.source == source {
            declared.insert((row.component.clone(), row.section.clone()));
        }
        if row.section == "logic" {
            flows
                .entry((
                    row.component.clone(),
                    row.component_label.clone(),
                    row.source.clone(),
                ))
                .or_default()
                .push((unit.prose_range.start, row.facet.clone()));
        }
        placed.push((unit.prose_range.start, row));
    }
    // Handles follow source, then offset, the same order the flows keep.
    placed.sort_by(|(a_at, a), (b_at, b)| (&a.source, a_at).cmp(&(&b.source, b_at)));
    for (number, (_, mut row)) in placed.into_iter().enumerate() {
        row.handle = handle(number + 1);
        rows.push(row);
    }
    rows.sort_by(|a, b| a.facet.cmp(&b.facet));

    let flows: Vec<LogicSection> = flows
        .into_iter()
        .map(|((component, component_label, source), mut facets)| {
            facets.sort_by_key(|(offset, _)| *offset);
            LogicSection {
                component,
                component_label,
                source,
                facets: facets.into_iter().map(|(_, facet)| facet).collect(),
            }
        })
        .collect();

    let mut entities: Vec<_> = input
        .entities
        .iter()
        .filter(|e| closure.contains(&e.source))
        .map(|e| AdmissibleEntity {
            id: e.id.clone(),
            kind: format!("{:?}", e.kind),
            label: e.label.clone(),
            owner: e.owner.clone(),
            source: e.source.clone(),
        })
        .collect();
    entities.sort_by(|a, b| a.id.cmp(&b.id));

    let labels: BTreeMap<&str, &str> = input
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.label.as_str()))
        .collect();
    let mut taken: BTreeMap<&str, BTreeMap<&str, BTreeSet<&str>>> = BTreeMap::new();
    for import in &input.imports {
        if import.status != ImportStatus::Resolved || !closure.contains(&import.source) {
            continue;
        }
        let Some(provider) = import.provider_id.as_deref() else {
            continue;
        };
        let names = taken
            .entry(import.source.as_str())
            .or_default()
            .entry(provider)
            .or_default();
        names.extend(
            import
                .names
                .iter()
                .filter(|n| n.status == SelectionStatus::Resolved)
                .map(|n| n.name.as_str()),
        );
    }
    let imports: Vec<SourceImports> = taken
        .into_iter()
        .map(|(source, providers)| SourceImports {
            source: source.to_owned(),
            from: providers
                .into_iter()
                .map(|(provider, names)| ImportedFrom {
                    component: provider.to_owned(),
                    component_label: labels.get(provider).copied().unwrap_or(provider).to_owned(),
                    names: names.into_iter().map(str::to_owned).collect(),
                })
                .collect(),
        })
        .collect();

    let binding = Binding {
        format: REQUEST_FORMAT,
        source: source.to_owned(),
        export_digest: export_digest(input),
        guidance_fingerprint: guidance::fingerprint(),
        vocabulary_generation: vocabulary::VOCABULARY_GENERATION,
        closure: closure.into_iter().collect(),
        facets: rows.iter().map(|r| r.facet.clone()).collect(),
    };
    Ok(Request {
        binding,
        rows,
        flows,
        entities,
        imports,
        declared: declared.into_iter().collect(),
    })
}

/// A Facet's row, or `None` when the unit is not an interpretable Facet.
///
/// Structurally invalid units and units outside a component are skipped: the
/// compiler already reports them, and neither can carry a commitment.
fn facet_row(input: &DesignInput, unit: &Unit) -> Result<Option<FacetRow>, String> {
    if !unit.valid {
        return Ok(None);
    }
    let Some(owner) = unit.owner.as_deref() else {
        return Ok(None);
    };
    let text = &input
        .sources
        .iter()
        .find(|s| s.path == unit.source)
        .ok_or_else(|| format!("Facet {} names an unexported source", unit.id))?
        .text;
    let prose = text
        .get(unit.prose_range.start..unit.prose_range.end)
        .ok_or_else(|| {
            format!(
                "Facet {} prose range {}..{} is not a character boundary of {}",
                unit.id, unit.prose_range.start, unit.prose_range.end, unit.source
            )
        })?;
    let label = input
        .entities
        .iter()
        .find(|e| e.id == owner)
        .map(|e| e.label.clone())
        .unwrap_or_default();
    Ok(Some(FacetRow {
        facet: unit.id.clone(),
        handle: String::new(),
        component: owner.to_owned(),
        component_label: label,
        section: vocabulary::section_name(&unit.section).to_owned(),
        source: unit.source.clone(),
        prose: prose.to_owned(),
    }))
}

/// Write the request, the binding and the guidance into a fresh directory.
///
/// The caller keeps this directory, produces claims from it independently, and
/// passes the binding back to ingest. Refusing a non-empty destination keeps a
/// stale binding from being silently paired with a new request.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn write(request: &Request, out: &Path) -> Result<Vec<PathBuf>, String> {
    match std::fs::read_dir(out) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                return Err(format!(
                    "preparation directory is not empty: {}",
                    out.display()
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
        }
        Err(e) => return Err(format!("{}: {e}", out.display())),
    }

    let mut written = Vec::new();
    let mut emit = |name: &str, bytes: &[u8]| -> Result<(), String> {
        let path = out.join(name);
        std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path);
        Ok(())
    };
    emit("binding.json", &json(&request.binding)?)?;
    emit("request.json", &json(request)?)?;
    emit(BRIEF, brief(request).as_bytes())?;
    for doc in guidance::BUNDLE {
        emit(doc.name, doc.text.as_bytes())?;
    }
    Ok(written)
}

/// The file the interpreter reads, beside the tool-side request and binding.
pub const BRIEF: &str = "brief.md";

/// The handle for a Facet's 1-based position in the closure.
fn handle(number: usize) -> String {
    format!("f{number}")
}

/// A handle's number, so `f10` orders after `f9`.
pub fn handle_number(handle: &str) -> Option<usize> {
    handle.strip_prefix('f')?.parse().ok()
}

/// Render the interpretation brief: what the interpreter reads instead of the
/// request.
///
/// Each presented Facet is one line, its handle and then its prose with the
/// line breaks folded, under its component and contract role. Entities and
/// imports are listed by label; a label two entities share also shows the
/// identities, since a row naming it by label alone is refused as ambiguous.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::InterpretationRequest interface
pub fn brief(request: &Request) -> String {
    let mut out = String::from("# Interpretation brief\n\n");
    if request.rows.is_empty() {
        out.push_str(
            "Nothing to interpret: every unit of this request is already stored. \
             Return an empty artifact.\n",
        );
        return out;
    }
    out.push_str(
        "Return rows for every `[fN]` line below. Name each Facet by its handle, \
         such as `f1`.\n",
    );

    let labels: BTreeMap<&str, &str> = request
        .entities
        .iter()
        .map(|e| (e.id.as_str(), e.label.as_str()))
        .collect();
    let ambiguous = identity::ambiguous_labels(request);
    out.push_str("\n## Entities\n\n");
    for entity in &request.entities {
        out.push_str(&format!("- {} ({}", entity.label, entity.kind));
        if let Some(owner) = &entity.owner {
            out.push_str(&format!(
                " of {}",
                labels.get(owner.as_str()).unwrap_or(&owner.as_str())
            ));
        }
        out.push(')');
        if ambiguous.contains(&entity.label) {
            out.push_str(&format!(" `{}`", entity.id));
        }
        out.push('\n');
    }
    if !request.imports.is_empty() {
        out.push_str("\n## Imports\n\n");
        for source in &request.imports {
            for from in &source.from {
                out.push_str(&format!(
                    "- {} imports from {}: {}\n",
                    source.source,
                    from.component_label,
                    from.names.join(", ")
                ));
            }
        }
    }

    let mut rows: Vec<&FacetRow> = request.rows.iter().collect();
    rows.sort_by_cached_key(|r| handle_number(&r.handle));
    let mut component = None;
    let mut section = None;
    for row in rows {
        let here = (row.component.as_str(), row.source.as_str());
        if component != Some(here) {
            out.push_str(&format!("\n## {} ({})\n", row.component_label, row.source));
            component = Some(here);
            section = None;
        }
        if section != Some(row.section.as_str()) {
            out.push_str(&format!("\n### {}\n\n", row.section));
            section = Some(row.section.as_str());
        }
        // Fold line breaks and their indentation only: a Tag never spans a
        // line, but one may hold repeated internal spaces that admission
        // matches exactly.
        let prose: Vec<&str> = row
            .prose
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        out.push_str(&format!("[{}] {}\n", row.handle, prose.join(" ")));
    }
    out.push_str("\nReturn rows for every `[fN]` line above, naming each Facet by its handle.\n");
    out
}

fn json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}
