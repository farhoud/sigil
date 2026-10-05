use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

mod support;
use support::{
    BASE, BASE_CONSTRAINTS, BASE_GOAL, BASE_INTERFACE, CONSUMER, CONSUMER_GOAL, CONSUMER_INTERFACE,
};

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "sigil-claims-cli-{}-{name}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    fn frontend_value(&self, value: serde_json::Value) -> PathBuf {
        let path = self.0.join("frontend.json");
        fs::write(&path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn claims(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_sigil-claims"))
        .args(args)
        .output()
        .expect("sigil-claims runs");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON: {e}\n{text}"))
}

fn clean_artifact() -> String {
    format!(
        "(reading {BASE_GOAL:?} \"no-commitment\")\n\
         (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
         (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
    )
}

/// Prepare, then return the scratch root, the export path and the binding path.
fn prepared(name: &str) -> (Scratch, PathBuf, PathBuf) {
    prepared_with_value(name, support::shared_value())
}

/// The same export with Base's Constraints unit presented as a Logic section.
/// Keeping the replacement the same byte length preserves the fixture's
/// offset-derived identities while providing a cached Step for admission.
fn prepared_with_cached_logic(name: &str) -> (Scratch, PathBuf, PathBuf) {
    let mut value = support::shared_value();
    let source = value["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|source| source["path"] == BASE)
        .unwrap();
    let text = source["text"].as_str().unwrap();
    assert!(text.contains("constraints {"));
    source["text"] = serde_json::json!(text.replacen("constraints {", "logic       {", 1));
    let unit = value["units"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|unit| unit["id"] == BASE_CONSTRAINTS)
        .unwrap();
    unit["section"] = serde_json::json!("logic");
    let group = value["groups"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|group| group["id"] == "group:base.sigil:73")
        .unwrap();
    group["section"] = serde_json::json!("logic");
    let introduction = value["introductions"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|introduction| introduction["id"] == "group:base.sigil:73")
        .unwrap();
    introduction["section"] = serde_json::json!("logic");
    prepared_with_value(name, value)
}

fn prepared_with_value(name: &str, value: serde_json::Value) -> (Scratch, PathBuf, PathBuf) {
    let scratch = Scratch::new(name);
    let frontend = scratch.frontend_value(value);
    let out = scratch.0.join("prep");
    prepare_into(&frontend, BASE, &out, &scratch.0);
    let binding = out.join("binding.json");
    assert!(binding.exists());
    (scratch, frontend, binding)
}

// ------------------------------------------------------------------ the flow

#[test]
fn a_full_pass_prepares_interprets_and_ingests() {
    // Covers F1.
    let (scratch, frontend, binding) = prepared("flow");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let result = json(&stdout);
    assert_eq!(result["state"], "coherent", "{stdout}");
    assert_eq!(result["findings"], 0);
    assert_eq!(result["source"], BASE);

    // Both artifacts land under the store this component owns.
    let report = Path::new(result["report"].as_str().unwrap());
    let context = Path::new(result["judgmentContext"].as_str().unwrap());
    assert!(report.starts_with(scratch.0.join(".sigil/claims")));
    assert!(context.starts_with(scratch.0.join(".sigil/claims")));
    let context = json(&fs::read_to_string(context).unwrap());
    assert_eq!(
        context["units"].as_array().unwrap().len(),
        3,
        "every unit reaches the judge"
    );
}

#[test]
fn a_design_level_contradiction_exits_one_and_names_its_findings() {
    let (scratch, frontend, binding) = prepared("gate");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (claim {BASE_CONSTRAINTS:?} \"Base\" \"provides\" \"value\" \"required\" \"false\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 1, "a gate failure exits 1: {stdout}{stderr}");
    assert_eq!(json(&stdout)["state"], "disjoint");
}

#[test]
fn a_repeat_interpretation_is_reported_only_when_supplied() {
    let (scratch, frontend, binding) = prepared("repeat");
    let first = scratch.0.join("first.egg");
    let second = scratch.0.join("second.egg");
    fs::write(&first, clean_artifact()).unwrap();
    fs::write(
        &second,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
             (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();

    let run = |extra: &[&str]| {
        let mut args = vec![
            "ingest",
            "--frontend",
            frontend.to_str().unwrap(),
            "--binding",
            binding.to_str().unwrap(),
            "--claims",
            first.to_str().unwrap(),
            "--root",
            scratch.0.to_str().unwrap(),
        ];
        args.extend_from_slice(extra);
        let (code, stdout, stderr) = claims(&args);
        assert_eq!(code, 0, "{stdout}{stderr}");
        let path = json(&stdout)["report"].as_str().unwrap().to_string();
        json(&fs::read_to_string(path).unwrap())
    };

    let without = run(&[]);
    assert!(
        without.get("disagreements").is_none(),
        "the comparison costs an extra interpretation: {without}"
    );

    let with = run(&["--claims-repeat", second.to_str().unwrap()]);
    let entries = with["disagreements"].as_array().unwrap();
    assert_eq!(entries.len(), 2, "{with}");
    for entry in entries {
        assert_eq!(entry["facet"], BASE_INTERFACE);
        assert_eq!(entry["section"], "interface");
    }
}

#[test]
fn a_supplied_cached_unit_is_compared_without_replacing_its_saved_reading() {
    let (scratch, frontend, binding) = prepared("cached-repeat");
    let first = scratch.0.join("first.egg");
    fs::write(&first, clean_artifact()).unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let out = scratch.0.join("prep-again");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--frontend",
        frontend.to_str().unwrap(),
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert_eq!(json(&stdout)["facets"], 0, "all first readings are cached");

    let second = scratch.0.join("second.egg");
    fs::write(
        &second,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"result\" \"required\" \"true\")\n\
             (claim {BASE_CONSTRAINTS:?} \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    let second_binding = out.join("binding.json");
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        second_binding.to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let result = json(&stdout);
    let report = json(&fs::read_to_string(result["report"].as_str().unwrap()).unwrap());
    let disagreements = report["disagreements"].as_array().unwrap();
    assert_eq!(disagreements.len(), 2, "{report}");
    assert!(
        disagreements
            .iter()
            .any(|entry| { entry["facet"] == BASE_INTERFACE && entry["onlyIn"] == "first" })
    );
    assert!(
        disagreements
            .iter()
            .any(|entry| { entry["facet"] == BASE_INTERFACE && entry["onlyIn"] == "repeat" })
    );

    let context = json(&fs::read_to_string(result["judgmentContext"].as_str().unwrap()).unwrap());
    let interface = context["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|unit| unit["facet"] == BASE_INTERFACE)
        .unwrap();
    assert!(
        interface["asserted"]
            .as_array()
            .unwrap()
            .iter()
            .any(|claim| {
                claim["body"]["object"]
                    .as_str()
                    .is_some_and(|object| object.ends_with(":tag:value"))
            }),
        "the second reading must not replace the cached first reading: {context}"
    );

    // An explicit repeat is a separate comparison input. It must not suppress
    // the cached-unit second reading already carried by --claims.
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        second_binding.to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--claims-repeat",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());
    let disagreements = report["disagreements"].as_array().unwrap();
    assert_eq!(disagreements.len(), 2, "{report}");
}

#[test]
fn a_cached_logic_step_is_available_when_admitting_a_second_reading() {
    let (scratch, frontend, binding) = prepared_with_cached_logic("cached-step-admission");
    let first = scratch.0.join("first.egg");
    fs::write(
        &first,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (step {BASE_CONSTRAINTS:?} \"1\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        first.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let out = scratch.0.join("prep-again");
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--frontend",
        frontend.to_str().unwrap(),
        "--source",
        BASE,
        "--out",
        out.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert_eq!(json(&stdout)["facets"], 0);

    let second = scratch.0.join("second.egg");
    fs::write(
        &second,
        format!(
            "(reading {BASE_GOAL:?} \"no-commitment\")\n\
             (claim {BASE_GOAL:?} \"step:1\" \"reads\" \"Base\" \"required\" \"true\")\n"
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        out.join("binding.json").to_str().unwrap(),
        "--claims",
        second.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(
        code, 0,
        "the stored Logic Step must be composed with the supplied Goal before admission: {stdout}{stderr}"
    );
}

#[test]
fn a_claim_for_a_facet_outside_the_request_is_refused() {
    let (scratch, frontend, binding) = prepared("foreign-facet");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "{}(claim \"facet:foreign.sigil:0\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n",
            clean_artifact()
        ),
    )
    .unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("facet:foreign.sigil:0"), "{stderr}");
    assert!(stderr.contains("did not ask about"), "{stderr}");
}

// ------------------------------------------------------------------ handles

fn ingest(
    frontend: &Path,
    binding: &Path,
    artifact: &Path,
    root: &Path,
    extra: &[&str],
) -> (i32, String, String) {
    let mut args = vec![
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        root.to_str().unwrap(),
    ];
    args.extend_from_slice(extra);
    claims(&args)
}

fn prepare_into(frontend: &Path, source: &str, out: &Path, root: &Path) -> serde_json::Value {
    let (code, stdout, stderr) = claims(&[
        "prepare",
        "--frontend",
        frontend.to_str().unwrap(),
        "--source",
        source,
        "--out",
        out.to_str().unwrap(),
        "--root",
        root.to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    json(&stdout)
}

/// The prepared request's Facet for each handle it issued.
fn handles_of(binding: &Path) -> std::collections::BTreeMap<String, String> {
    let request = json(&fs::read_to_string(binding.with_file_name("request.json")).unwrap());
    request["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["handle"].as_str().unwrap().to_owned(),
                row["facet"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

/// Every stored row under the root's interpretation store, as written.
fn stored_rows(root: &Path) -> Vec<serde_json::Value> {
    let dir = root.join(".sigil/claims/interpretations");
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for entry in entries {
        let stored = json(&fs::read_to_string(entry.unwrap().path()).unwrap());
        rows.extend(stored["rows"].as_array().unwrap().iter().cloned());
    }
    rows
}

/// Every Facet-naming column of the stored rows holds a Facet id, never a handle.
fn assert_stored_rows_name_facet_ids(root: &Path) {
    let rows = stored_rows(root);
    assert!(!rows.is_empty(), "nothing was stored");
    for row in &rows {
        let (kind, body) = row.as_object().unwrap().iter().next().unwrap();
        assert!(
            body["facet"].as_str().unwrap().starts_with("facet:"),
            "stored {kind} row names a handle: {row}"
        );
        if kind == "guard" && body["operand"] == "constraint" {
            assert!(
                body["value"].as_str().unwrap().starts_with("facet:"),
                "stored constraint guard names a handle: {row}"
            );
        }
    }
}

/// A second reading that disagrees with `clean_artifact` on what Base provides.
fn disagreeing_handle_artifact() -> String {
    handle_artifact().replace("\"provides\" \"value\"", "\"provides\" \"result\"")
}

fn handle_artifact() -> String {
    "(reading \"f1\" \"no-commitment\")\n\
     (claim \"f3\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
     (claim \"f2\" \"Base\" \"owns\" \"value\" \"required\" \"true\")\n"
        .to_owned()
}

#[test]
fn rows_naming_handles_are_admitted_like_rows_naming_facet_ids() {
    let (by_id, frontend, binding) = prepared("by-id");
    let handles = handles_of(&binding);
    assert_eq!(handles["f1"], BASE_GOAL);
    assert_eq!(handles["f2"], BASE_CONSTRAINTS);
    assert_eq!(handles["f3"], BASE_INTERFACE);
    let artifact = by_id.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &artifact, &by_id.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let id_report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());

    let (by_handle, frontend, binding) = prepared("by-handle");
    let artifact = by_handle.0.join("result.egg");
    fs::write(&artifact, handle_artifact()).unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &artifact, &by_handle.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let handle_report =
        json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());

    assert_eq!(handle_report["state"], id_report["state"]);
    assert_eq!(handle_report["findings"], id_report["findings"]);
    let mut id_rows = stored_rows(&by_id.0);
    let mut handle_rows = stored_rows(&by_handle.0);
    id_rows.sort_by_key(|row| row.to_string());
    handle_rows.sort_by_key(|row| row.to_string());
    assert_eq!(handle_rows, id_rows, "a handle is stored as its Facet");
    assert_stored_rows_name_facet_ids(&by_handle.0);
}

#[test]
fn a_handle_the_request_did_not_issue_is_refused_by_name() {
    // Covers AE1. base.sigil's closure issues f1 to f3.
    let (scratch, frontend, binding) = prepared("unissued-handle");
    assert_eq!(handles_of(&binding).len(), 3);
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "{}(claim \"f4\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n",
            handle_artifact()
        ),
    )
    .unwrap();
    let (code, _, stderr) = ingest(&frontend, &binding, &artifact, &scratch.0, &[]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("\"f4\""), "{stderr}");
    assert!(stderr.contains("numbers no Facet"), "{stderr}");
    assert!(
        stored_rows(&scratch.0).is_empty(),
        "a refused artifact stores nothing"
    );
}

#[test]
fn a_constraint_guard_naming_an_unissued_handle_is_refused_by_name() {
    let (scratch, frontend, binding) = prepared("unissued-guard-handle");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "{}(step \"f2\" \"1\")\n(guard \"f2\" \"1\" \"constraint\" \"f9\")\n",
            handle_artifact()
        ),
    )
    .unwrap();
    let (code, _, stderr) = ingest(&frontend, &binding, &artifact, &scratch.0, &[]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("\"f9\""), "{stderr}");
    assert!(stderr.contains("numbers no Facet"), "{stderr}");
}

#[test]
fn a_constraint_guard_resolves_its_handle_and_an_input_guard_keeps_its_literal() {
    let path = "flow.sigil";
    let text = "component Flow {\n  constraints {\n    Check the caller first.\n  }\n  logic {\n    Check then act.\n  }\n}\n";
    let id = format!("urn:sigil:component:{path}:Flow");
    let unit = |prose: &str, section: &str| {
        let start = text.find(prose).unwrap();
        let end = start + prose.len();
        serde_json::json!({"id": format!("facet:{path}:{start}"), "source": path, "owner": id,
            "section": section, "range": {"start": start, "end": end},
            "proseRange": {"start": start, "end": end}, "grouping": null,
            "introductions": [], "references": [], "links": [],
            "payload": null, "valid": true, "complete": true})
    };
    let constraints = unit("Check the caller first.", "constraints");
    let logic = unit("Check then act.", "logic");
    let value = serde_json::json!({
        "schemaVersion": 2, "languageVersion": "0.9.0", "frontendVersion": "test",
        "sources": [{"path": path, "text": text}],
        "context": [
            {"path": ".sigil/config.json", "text": "{\"sigilVersion\":\"0.9.0\"}"},
            {"path": ".sigil/local.json", "text": null},
            {"path": ".sigil/glossary.json", "text": null}
        ],
        "diagnostics": [], "entities": [support::component(path, "Flow", text)],
        "units": [constraints, logic], "imports": [], "groups": [], "introductions": [],
        "references": [], "links": []
    });
    let scratch = Scratch::new("guard-handles");
    let frontend = scratch.frontend_value(value);
    let out = scratch.0.join("prep");
    prepare_into(&frontend, path, &out, &scratch.0);
    let binding = out.join("binding.json");
    let handles = handles_of(&binding);
    assert_eq!(handles["f1"], constraints["id"].as_str().unwrap());
    assert_eq!(handles["f2"], logic["id"].as_str().unwrap());

    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        "(reading \"f1\" \"no-commitment\")\n\
         (step \"f2\" \"1\")\n\
         (guard \"f2\" \"1\" \"constraint\" \"f1\")\n\
         (guard \"f2\" \"1\" \"input\" \"f3\")\n",
    )
    .unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &artifact, &scratch.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let guards: Vec<_> = stored_rows(&scratch.0)
        .into_iter()
        .filter_map(|row| row.get("guard").cloned())
        .collect();
    assert_eq!(guards.len(), 2, "{guards:?}");
    for guard in &guards {
        assert_eq!(guard["facet"], logic["id"]);
        match guard["operand"].as_str().unwrap() {
            "constraint" => assert_eq!(guard["value"], constraints["id"]),
            "input" => assert_eq!(guard["value"], "f3", "an input literal is not a handle"),
            other => panic!("unexpected operand {other}"),
        }
    }
    assert_stored_rows_name_facet_ids(&scratch.0);
}

#[test]
fn a_handle_of_a_reused_unit_is_admitted_as_a_second_reading() {
    let (scratch, frontend, binding) = prepared("cached-handle");
    let first = scratch.0.join("first.egg");
    fs::write(&first, clean_artifact()).unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &first, &scratch.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");

    let out = scratch.0.join("prep-again");
    let prepared = prepare_into(&frontend, BASE, &out, &scratch.0);
    assert_eq!(prepared["facets"], 0, "all first readings are cached");
    let second_binding = out.join("binding.json");
    // The presented request is empty, so f1 to f3 name reused units only.

    let second = scratch.0.join("second.egg");
    fs::write(&second, disagreeing_handle_artifact()).unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &second_binding, &second, &scratch.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());
    let disagreements = report["disagreements"].as_array().unwrap();
    assert_eq!(disagreements.len(), 2, "{report}");
    for entry in disagreements {
        assert_eq!(entry["facet"], BASE_INTERFACE, "{report}");
    }
    assert_stored_rows_name_facet_ids(&scratch.0);
}

#[test]
fn shifted_handles_leave_unchanged_units_reused() {
    // Covers AE3. consumer.sigil's closure numbers base.sigil first, so a Facet
    // added to base.sigil moves every consumer.sigil handle.
    let scratch = Scratch::new("shifted-handles");
    let frontend = scratch.frontend_value(support::shared_value());
    let out = scratch.0.join("prep");
    let prepared = prepare_into(&frontend, CONSUMER, &out, &scratch.0);
    assert_eq!(prepared["facets"], 5);
    let binding = out.join("binding.json");
    let handles = handles_of(&binding);
    assert_eq!(handles["f4"], CONSUMER_GOAL);
    assert_eq!(handles["f5"], CONSUMER_INTERFACE);

    let artifact = scratch.0.join("first.egg");
    fs::write(
        &artifact,
        format!(
            "{}(reading \"f4\" \"no-commitment\")\n\
             (claim \"f5\" \"Consumer\" \"uses\" \"value\" \"required\" \"true\")\n",
            handle_artifact()
        ),
    )
    .unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &artifact, &scratch.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    assert_stored_rows_name_facet_ids(&scratch.0);

    // Append a component to base.sigil, keeping every existing offset.
    let mut value = support::shared_value();
    let base = value["sources"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|source| source["path"] == BASE)
        .unwrap();
    let text = format!(
        "{}component Extra {{\ngoal {{\nKeep the extra.\n}}\n}}\n",
        base["text"].as_str().unwrap()
    );
    base["text"] = serde_json::json!(text);
    value["entities"]
        .as_array_mut()
        .unwrap()
        .push(support::component(BASE, "Extra", &text));
    let extra = support::unit(BASE, "Extra", &text, "Keep the extra.");
    value["units"].as_array_mut().unwrap().push(extra.clone());
    let frontend = scratch.frontend_value(value);

    let out = scratch.0.join("prep-again");
    let prepared = prepare_into(&frontend, CONSUMER, &out, &scratch.0);
    assert_eq!(prepared["facets"], 1, "only the new Facet is stale");
    assert_eq!(prepared["reusedUnits"], 5, "unchanged units are reused");
    let binding = out.join("binding.json");
    let handles = handles_of(&binding);
    assert_eq!(handles.len(), 1, "{handles:?}");
    assert_eq!(handles["f4"], extra["id"].as_str().unwrap());

    // The closure alone fixes the numbering, so an empty store shows the whole
    // table the reused units are numbered by.
    let fresh = Scratch::new("shifted-handles-fresh");
    let out_fresh = fresh.0.join("prep");
    prepare_into(&frontend, CONSUMER, &out_fresh, &fresh.0);
    let handles = handles_of(&out_fresh.join("binding.json"));
    assert_eq!(handles["f4"], extra["id"].as_str().unwrap());
    assert_eq!(
        handles["f5"], CONSUMER_GOAL,
        "consumer.sigil's handles shift"
    );
    assert_eq!(handles["f6"], CONSUMER_INTERFACE);

    // f4 is the new Facet, and f5 a second reading that agrees with the stored
    // consumer.sigil goal. Numbering only the presented Facet would call it f1.
    let artifact = scratch.0.join("second.egg");
    fs::write(
        &artifact,
        "(reading \"f4\" \"no-commitment\")\n(reading \"f5\" \"no-commitment\")\n",
    )
    .unwrap();
    let (code, stdout, stderr) = ingest(&frontend, &binding, &artifact, &scratch.0, &[]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());
    assert!(
        report["disagreements"]
            .as_array()
            .is_none_or(|entries| entries.is_empty()),
        "f5 must resolve to the consumer.sigil goal: {report}"
    );
    assert_stored_rows_name_facet_ids(&scratch.0);
    let prepared = prepare_into(
        &frontend,
        CONSUMER,
        &scratch.0.join("prep-third"),
        &scratch.0,
    );
    assert_eq!(prepared["facets"], 0, "{prepared}");
}

#[test]
fn a_repeat_interpretation_resolves_handles_against_the_same_table() {
    let (scratch, frontend, binding) = prepared("repeat-handles");
    let first = scratch.0.join("first.egg");
    let second = scratch.0.join("second.egg");
    fs::write(&first, clean_artifact()).unwrap();
    fs::write(&second, disagreeing_handle_artifact()).unwrap();
    let repeat = ["--claims-repeat", second.to_str().unwrap()];
    let (code, stdout, stderr) = ingest(&frontend, &binding, &first, &scratch.0, &repeat);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let report = json(&fs::read_to_string(json(&stdout)["report"].as_str().unwrap()).unwrap());
    let entries = report["disagreements"].as_array().unwrap();
    assert_eq!(entries.len(), 2, "{report}");
    for entry in entries {
        assert_eq!(entry["facet"], BASE_INTERFACE);
    }

    fs::write(
        &second,
        "(claim \"f9\" \"Base\" \"provides\" \"value\" \"required\" \"true\")\n",
    )
    .unwrap();
    let (code, _, stderr) = ingest(&frontend, &binding, &first, &scratch.0, &repeat);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("\"f9\""), "{stderr}");
}

// ----------------------------------------------------------- binding refusal

#[test]
fn a_binding_that_does_not_match_the_supplied_export_is_refused() {
    let (scratch, frontend, binding) = prepared("stale-export");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["exportDigest"] = serde_json::json!("a-different-export");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("export digest"), "{stderr}");
    assert!(stderr.contains("Prepare a new directory"), "{stderr}");
}

#[test]
fn a_binding_from_a_different_guidance_build_is_refused() {
    let (scratch, frontend, binding) = prepared("stale-guidance");
    let artifact = scratch.0.join("result.egg");
    fs::write(&artifact, clean_artifact()).unwrap();

    let mut tampered = json(&fs::read_to_string(&binding).unwrap());
    tampered["guidanceFingerprint"] = serde_json::json!("guidance-from-another-build");
    fs::write(&binding, serde_json::to_vec(&tampered).unwrap()).unwrap();

    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(stderr.contains("guidance fingerprint"), "{stderr}");
}

// ------------------------------------------------------------- exit contract

#[test]
fn the_tool_names_itself_and_not_the_compiler() {
    let (code, stdout, _) = claims(&["--version"]);
    assert_eq!(code, 0);
    assert!(stdout.starts_with("sigil-claims "), "{stdout}");

    let (code, stdout, _) = claims(&["--help"]);
    assert_eq!(code, 0);
    assert!(stdout.contains("computed design validation"), "{stdout}");
    assert!(
        stdout.contains("never launches a model"),
        "the boundary belongs in the help text: {stdout}"
    );
}

#[test]
fn a_usage_error_exits_two_and_an_unreadable_input_exits_three() {
    for args in [
        vec!["nonsense"],
        vec![],
        vec!["prepare", "--frontend", "f.json"],
        vec!["ingest", "--unknown", "x"],
        vec!["prepare", "--frontend"],
    ] {
        let (code, _, stderr) = claims(&args);
        assert_eq!(code, 2, "{args:?} must be a usage error: {stderr}");
    }

    let (code, _, stderr) = claims(&[
        "prepare",
        "--frontend",
        "/nonexistent/frontend.json",
        "--source",
        BASE,
        "--out",
        "/tmp/unused-claims-out",
    ]);
    assert_eq!(code, 3, "an unreadable input is operational: {stderr}");
}

#[test]
fn an_artifact_carrying_a_rule_is_a_gate_failure_not_a_crash() {
    let (scratch, frontend, binding) = prepared("rule");
    let artifact = scratch.0.join("result.egg");
    fs::write(
        &artifact,
        format!(
            "(claim {BASE_INTERFACE:?} \"Base\" \"provides\" \"value\" \"required\" \"true\")\n\
             (rule ((holds a b c)) ((reachable a b)))\n"
        ),
    )
    .unwrap();
    let (code, _, stderr) = claims(&[
        "ingest",
        "--frontend",
        frontend.to_str().unwrap(),
        "--binding",
        binding.to_str().unwrap(),
        "--claims",
        artifact.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 1, "{stderr}");
    assert!(stderr.contains("claim data only"), "{stderr}");
}

// --------------------------------------------------------------- guidance

#[test]
fn guidance_extracts_to_a_named_directory() {
    let scratch = Scratch::new("extract");
    let out = scratch.0.join("guidance");
    let (code, stdout, stderr) = claims(&[
        "extract-guidance",
        "--out",
        out.to_str().unwrap(),
        "--root",
        std::env::temp_dir().join("elsewhere").to_str().unwrap(),
    ]);
    assert_eq!(code, 0, "{stdout}{stderr}");
    let written = json(&stdout)["written"].as_array().unwrap().len();
    assert_eq!(written, 4, "{stdout}");
    for name in ["sections.md", "vocabulary.md", "examples.md", "rejected.md"] {
        assert!(out.join(name).exists(), "{name} was not extracted");
    }
}

#[test]
fn guidance_is_refused_when_it_would_land_in_the_workspace_under_validation() {
    let scratch = Scratch::new("refuse");
    let inside = scratch.0.join("guidance");
    let (code, _, stderr) = claims(&[
        "extract-guidance",
        "--out",
        inside.to_str().unwrap(),
        "--root",
        scratch.0.to_str().unwrap(),
    ]);
    assert_eq!(code, 2, "{stderr}");
    assert!(!inside.exists(), "a refused extraction writes nothing");
}

// ---------------------------------------------------------- the compiler

#[test]
fn the_compilers_own_command_surface_is_unchanged() {
    let output = Command::new(env!("CARGO_BIN_EXE_sigilc"))
        .arg("--help")
        .output()
        .unwrap();
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.starts_with("sigilc — deterministic Semantic Worlds compiler"));
    for command in [
        "prepare design",
        "ingest design",
        "compile design",
        "compare",
        "clean",
    ] {
        assert!(
            help.contains(command),
            "{command} vanished from sigilc help"
        );
    }
    assert!(
        !help.contains("sigil-claims"),
        "the compiler must not advertise another binary's commands"
    );
}

// ------------------------------------------------------- ownership annotations

#[test]
fn every_claims_module_is_owned_by_a_tag_the_contract_declares() {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // The subsystem is owned by two contracts: the claims component, and the
    // vocabulary component that owns the accepted set and the atom discipline.
    // An annotation must name one of them and a Tag that contract declares.
    let tags_of = |contract: &str| -> Vec<String> {
        contract
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                trimmed
                    .strip_suffix(" {")
                    .filter(|name| {
                        name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                            && name.chars().all(|c| c.is_ascii_alphanumeric())
                    })
                    .map(str::to_owned)
            })
            .collect()
    };
    let owners: Vec<(&str, Vec<String>)> = vec![
        (
            "packages/sigilc/claims.sigil::SigilComputedClaims::",
            tags_of(&fs::read_to_string(crate_dir.join("claims.sigil")).unwrap()),
        ),
        (
            "packages/sigilc/vocabulary.sigil::SigilClaimsVocabulary::",
            tags_of(&fs::read_to_string(crate_dir.join("vocabulary.sigil")).unwrap()),
        ),
    ];
    assert!(
        owners[0].1.contains(&"ClaimsCommands".to_owned()),
        "expected the claims contract's concepts, got {:?}",
        owners[0].1
    );
    assert!(
        owners[1].1.contains(&"AcceptedVocabulary".to_owned()),
        "expected the vocabulary contract's concepts, got {:?}",
        owners[1].1
    );

    let mut checked = 0;
    for entry in fs::read_dir(crate_dir.join("src/claims")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        if name == "mod.rs" {
            continue; // Module declarations only; no entrypoint to own.
        }
        let text = fs::read_to_string(&path).unwrap();
        let annotations: Vec<&str> = text
            .lines()
            .filter(|l| l.contains("@sigil implements"))
            .collect();
        assert!(
            !annotations.is_empty(),
            "{name} carries no ownership annotation"
        );
        for annotation in annotations {
            let owner = owners
                .iter()
                .find(|(prefix, _)| annotation.contains(prefix))
                .unwrap_or_else(|| panic!("{name}: {annotation} names neither owning contract"));
            let tag = annotation
                .split(owner.0)
                .nth(1)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap();
            assert!(
                owner.1.iter().any(|declared| declared == tag),
                "{name} claims {tag}, which {} does not declare",
                owner.0
            );
        }
        checked += 1;
    }
    assert!(checked >= 8, "expected every claims module, saw {checked}");
}
