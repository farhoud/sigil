//! The command boundary for computed design validation.
//!
//! Deterministic, like the compiler's: no process launchers and no model
//! options. The external interpretation is an input the caller supplies and can
//! supply again, which is what makes a run reproducible.
use super::{context, dialect, findings, guidance, identity, memo, prepare, program, vocabulary};
use crate::{
    cli::{FRONTEND_REMOVED, Output, store_dir},
    eqval,
    frontend::DesignInput,
    inputs::DesignBasis,
    tree::design_input::load_design,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

const MAX_BINDING_BYTES: u64 = 16_000_000;

pub fn help() -> String {
    r#"sigil-claims — computed design validation

Commands:
  prepare --source PATH --out NEW_DIR [--root DIR] [--store DIR]
  ingest --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR] [--store DIR]
  extract-guidance --out DIR [--root DIR]

--root DIR is the workspace; sigil-claims reads its .sigil configuration and
sources directly (default: the current directory). --store DIR holds the stored
interpretations and the reports (default: ROOT/.sigil).

Flow:
  1. Prepare one source:       sigil-claims prepare --root . \
                                 --source a.sigil --out claims-a
  2. An external interpreter reads claims-a and writes Datalog claims.
  3. Ingest the result:        sigil-claims ingest --root . \
                                 --binding claims-a/binding.json --claims claims-a/result.egg

This command never launches a model. Step 3 is the caller's, and passing the
same artifact again reproduces the same report.

Gate exits: 0 = pass or warning, 1 = a gate failure (a computed Disjoint
verdict, a refused artifact, or a saturation-limit breach), 2 = usage,
3 = operational failure.
"#
    .into()
}

/// Parse and run one invocation.
// @sigil implements packages/sigilc/claims.sigil::SigilComputedClaims::ClaimsCommands interface,constraints
pub fn run(args: &[&str]) -> Output {
    let (command, tail) = match args {
        [] => return Err((2, "Expected a command. Run sigil-claims --help.".into())),
        ["--help"] | ["-h"] => return Ok((0, help())),
        ["--version"] => {
            return Ok((0, format!("sigil-claims {}\n", env!("CARGO_PKG_VERSION"))));
        }
        [
            command @ ("prepare" | "ingest" | "extract-guidance"),
            tail @ ..,
        ] => (*command, tail),
        _ => return Err((2, "Invalid command. Run sigil-claims --help.".into())),
    };

    let allowed: &[&str] = match command {
        // The store reaches prepare too: past interpretations live in it, and
        // prepare is what decides which units are still stale.
        "prepare" => &["--source", "--out", "--root", "--store"],
        "ingest" => &[
            "--binding",
            "--claims",
            "--claims-repeat",
            "--root",
            "--store",
        ],
        _ => &["--out", "--root"],
    };
    let options = parse(tail, allowed)?;
    if options.values().filter(|v| v.as_str() == "-").count() > 1 {
        return Err((2, "only one input may read standard input".into()));
    }
    let required = |flag: &str| required_in(&options, flag);
    let root = options
        .get("--root")
        .cloned()
        .unwrap_or_else(|| ".".to_string());
    let store = store_dir(Path::new(&root), options.get("--store").map(String::as_str));

    match command {
        "extract-guidance" => {
            let out = required("--out")?;
            let written = guidance::extract(Path::new(&out), Path::new(&root)).map_err(usage)?;
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "guidanceFingerprint": guidance::fingerprint(),
                    "written": written,
                }),
            )
        }
        "prepare" => {
            // Every required flag is resolved before anything is opened, so a
            // missing option is a usage error rather than whatever the
            // filesystem happens to say about the file that was supplied.
            let (source, out) = (required("--source")?, required("--out")?);
            let (input, basis) = workspace(&root, &store)?;
            let request = prepare::project(&input, &basis, &source).map_err(usage)?;

            // Ask only for what is stale. The binding is left whole: it is what
            // ingest recomputes and compares, so narrowing it would make every
            // prepared directory fail its own check. Only the presentation
            // narrows, and a request with nothing stale is valid and asks for
            // nothing. A stored reading whose grounding context moved is
            // re-checked here without a model call; the ones that still hold
            // have their recorded context refreshed.
            let split = memo::split(&request, &input, &store);
            let refreshed = memo::refresh(&store, &split).map_err(operational)?;
            let asked = prepare::presenting(&request, &split.stale);
            let written = prepare::write(&asked, Path::new(&out)).map_err(operational)?;
            let older = memo::older_entries(&store);
            json(
                0,
                &serde_json::json!({
                    "version": findings::REPORT_VERSION,
                    "binding": Path::new(&out).join("binding.json"),
                    "inputs": written,
                    "facets": asked.own_rows().count(),
                    "requestedUnits": split.stale.len(),
                    "reusedUnits": split.reused.len(),
                    "regroundedUnits": refreshed,
                    "uninterpretedContext": split.uninterpreted_context.len(),
                    "bindingDigest": request.binding.digest(),
                    "workspaceDigest": prepare::workspace_digest(&basis),
                    "olderMemoEntries": older,
                    "note": (older > 0).then(|| format!(
                        "{older} stored reading(s) were written by an older memo format and are ignored; every unit they covered will be read again, and they are removed at the next ingest"
                    )),
                }),
            )
        }
        _ => ingest(&options, &root, &store),
    }
}

fn ingest(options: &BTreeMap<String, String>, root: &str, store: &Path) -> Output {
    let (binding_path, claims_path) = (
        required_in(options, "--binding")?,
        required_in(options, "--claims")?,
    );
    let (input, basis) = workspace(root, store)?;
    let supplied: prepare::Binding = serde_json::from_slice(
        &crate::cli::read(&binding_path, MAX_BINDING_BYTES).map_err(operational)?,
    )
    .map_err(|e| operational(format!("{binding_path}: {e}")))?;

    // The request is recomputed from the workspace now, and the supplied
    // binding has to match it field by field. Only what the request is built
    // from can reject a binding, so an edit to an unrelated source or to a
    // dependency's private sections leaves it intact.
    let request = prepare::project(&input, &basis, &supplied.source).map_err(usage)?;
    if request.binding != supplied {
        return Err((2, mismatch(&request.binding, &supplied)));
    }

    let limits = dialect::Limits::default();
    let first_text = artifact(&claims_path, limits)?;
    let supplied = dialect::parse(&first_text, limits).map_err(gate)?;
    let requested_facets: BTreeSet<String> =
        request.own_rows().map(|row| row.facet.clone()).collect();
    if let Some(row) = supplied
        .iter()
        .find(|row| !requested_facets.contains(row.facet()))
    {
        return Err(gate(format!(
            "row ({} ...) names {:?}, which this request did not ask about",
            row.relation_name(),
            row.facet()
        )));
    }

    // Stored rows join first readings before admission, so the program sees the
    // whole design the request presents. A supplied reading for a cached unit
    // is composed with the other units' first readings before admission, then
    // compared against that stored answer; it never replaces the cache. Reused
    // rows are re-admitted: grounding runs here, so a stored claim naming an
    // entity that has since left the request is refused like any other. Stored
    // readings of imported interface Facets join as context; one this
    // source's request cannot admit is dropped rather than refusing the run,
    // because it was read in its own source's world, not this one's.
    let all_units = memo::units(&request);
    let split = memo::split(&request, &input, store);
    let stale_keys: BTreeSet<String> = split.stale.iter().map(|unit| unit.key.clone()).collect();
    let stale = split.stale;
    let reused: BTreeMap<String, Vec<dialect::Row>> = split
        .reused
        .into_iter()
        .map(|(unit, rows)| (unit.key, rows))
        .collect();
    let admitter = identity::Admitter::new(&request, &input);
    let mut rows = Vec::new();
    let mut comparison_rows = Vec::new();
    let mut has_cached_second_reading = false;
    for unit in all_units.iter().filter(|u| !u.context) {
        let mine: Vec<_> = supplied
            .iter()
            .filter(|row| unit.facets.iter().any(|facet| facet == row.facet()))
            .cloned()
            .collect();
        if stale_keys.contains(&unit.key) {
            rows.extend(mine.iter().cloned());
            comparison_rows.extend(mine);
        } else if let Some(stored) = reused.get(&unit.key) {
            rows.extend(stored.iter().cloned());
            if mine.is_empty() {
                comparison_rows.extend(stored.iter().cloned());
            } else {
                comparison_rows.extend(mine);
                has_cached_second_reading = true;
            }
        } else {
            return Err(operational(format!(
                "memo did not classify interpretation unit {}",
                unit.key
            )));
        }
    }
    for (_, stored) in &split.context {
        if admitter.admit(stored).is_ok() {
            rows.extend(stored.iter().cloned());
            comparison_rows.extend(stored.iter().cloned());
        }
    }
    rows.sort();
    rows.dedup();
    comparison_rows.sort();
    comparison_rows.dedup();
    let facts = identity::admit(&request, &input, &rows).map_err(gate)?;
    let comparison_facts = identity::admit(&request, &input, &comparison_rows).map_err(gate)?;

    // Only first readings of stale units are stored, and only after admission,
    // so a refused artifact or second reading leaves the cache untouched. Each
    // is stored with the defects admission accepted, so a later re-grounding
    // does not read them as new. Entries another memo version wrote are
    // removed first, and counted.
    let mut pruned = 0;
    let mut stored_units = 0;
    for unit in &stale {
        let mine: Vec<_> = supplied
            .iter()
            .filter(|r| unit.facets.iter().any(|f| f == r.facet()))
            .cloned()
            .collect();
        if !mine.is_empty() {
            if stored_units == 0 {
                pruned = memo::prune_older(store).map_err(operational)?;
            }
            let defects = facts
                .iter()
                .filter(|f| unit.facets.contains(&f.facet))
                .flat_map(|f| f.defects.iter().cloned())
                .collect();
            memo::save(store, &request, unit, &mine, defects).map_err(operational)?;
            stored_units += 1;
        }
    }

    let mut digests = vec![crate::sources::hash(first_text.as_bytes())];
    let mut comparisons = Vec::new();
    if has_cached_second_reading {
        comparisons.push(comparison_facts);
    }
    if let Some(path) = options.get("--claims-repeat") {
        let text = artifact(path, limits)?;
        digests.push(crate::sources::hash(text.as_bytes()));
        let rows = dialect::parse(&text, limits).map_err(gate)?;
        comparisons.push(identity::admit(&request, &input, &rows).map_err(gate)?);
    }

    let world = program::saturate(&request, &facts, eqval::Limits::default()).map_err(gate)?;
    let mut report = findings::report(&request, &facts, &world, &digests);
    let mut disagreements = Vec::new();
    for repeat in &comparisons {
        disagreements.extend(findings::disagreements(&facts, repeat));
    }
    if !comparisons.is_empty() {
        disagreements.sort();
        disagreements.dedup();
        findings::attach(&mut report, disagreements);
    }
    let context = context::build(&request, &facts, &world, report.identity.clone());

    let report_path = findings::write(&report, store).map_err(operational)?;
    let context_path =
        findings::store(&context, store, &context.source, context::SUFFIX).map_err(operational)?;

    let code = match report.state {
        findings::State::Disjoint => 1,
        _ => 0,
    };
    json(
        code,
        &serde_json::json!({
            "version": report.version,
            "source": report.source,
            "state": report.state,
            "findings": report.findings.len(),
            "report": report_path,
            "judgmentContext": context_path,
            "vocabularyGeneration": vocabulary::VOCABULARY_GENERATION,
            "guidanceFingerprint": report.identity.guidance_fingerprint,
            "storedUnits": stored_units,
            "prunedMemoEntries": pruned,
        }),
    )
}

/// Name every field that differs, so a caller can see which input moved.
fn mismatch(current: &prepare::Binding, supplied: &prepare::Binding) -> String {
    let mut differences = Vec::new();
    let mut note = |name: &str, a: &str, b: &str| {
        if a != b {
            differences.push(format!("{name} (binding {b}, current {a})"));
        }
    };
    note(
        "source content",
        &current.source_content,
        &supplied.source_content,
    );
    let hashes = |binding: &prepare::Binding| -> BTreeMap<String, String> {
        binding
            .interfaces
            .iter()
            .map(|i| (i.key(), i.hash.clone()))
            .collect()
    };
    let (now, then) = (hashes(current), hashes(supplied));
    for key in now.keys().chain(then.keys()).collect::<BTreeSet<_>>() {
        let (a, b) = (
            now.get(key).map_or("absent", String::as_str),
            then.get(key).map_or("absent", String::as_str),
        );
        note(&format!("interface of {key}"), a, b);
    }
    note(
        "guidance",
        &current.guidance_fingerprint,
        &supplied.guidance_fingerprint,
    );
    note(
        "vocabulary generation",
        &current.vocabulary_generation.to_string(),
        &supplied.vocabulary_generation.to_string(),
    );
    note(
        "format",
        &current.format.to_string(),
        &supplied.format.to_string(),
    );
    if current.facets != supplied.facets {
        differences.push("unit set".into());
    }
    if current.source != supplied.source {
        differences.push("source".into());
    }
    if differences.is_empty() {
        differences.push("binding contents".into());
    }
    format!(
        "binding does not match the current workspace: {}. Prepare a new directory.",
        differences.join(", ")
    )
}

/// The structural input of the workspace at `root` and the content identities
/// its trees bind on, read natively.
fn workspace(root: &str, store: &Path) -> Result<(DesignInput, DesignBasis), (u8, String)> {
    load_design(Path::new(root), store).map_err(operational)
}

fn artifact(path: &str, limits: dialect::Limits) -> Result<String, (u8, String)> {
    let bytes = crate::cli::read(path, limits.max_document_bytes as u64).map_err(operational)?;
    String::from_utf8(bytes).map_err(|_| gate("claims artifact is not valid UTF-8".to_string()))
}

fn required_in(options: &BTreeMap<String, String>, flag: &str) -> Result<String, (u8, String)> {
    options
        .get(flag)
        .cloned()
        .ok_or_else(|| (2, format!("missing required option: {flag}")))
}

fn parse(tail: &[&str], allowed: &[&str]) -> Result<BTreeMap<String, String>, (u8, String)> {
    let mut options = BTreeMap::new();
    let mut rest = tail;
    while let Some((flag, next)) = rest.split_first() {
        if *flag == "--frontend" {
            return Err((2, FRONTEND_REMOVED.into()));
        }
        if !allowed.contains(flag) || options.contains_key(*flag) {
            return Err((2, format!("unknown or duplicate option: {flag}")));
        }
        let Some((value, remaining)) = next.split_first() else {
            return Err((2, format!("missing value for {flag}")));
        };
        options.insert((*flag).to_string(), (*value).to_string());
        rest = remaining;
    }
    Ok(options)
}

fn usage(message: String) -> (u8, String) {
    (2, message)
}

fn gate(message: String) -> (u8, String) {
    (1, message)
}

fn operational(message: String) -> (u8, String) {
    (3, message)
}

fn json(code: u8, value: &impl serde::Serialize) -> Output {
    Ok((
        code,
        serde_json::to_string_pretty(value).map_err(|e| operational(e.to_string()))? + "\n",
    ))
}
