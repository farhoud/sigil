mod support;
use serde_json::{Value, json};
use sigilc::{inputs::DesignSnapshot, scope::Scope};
use support::Workspace;

fn edit(root: &Workspace, path: &str, from: &str, to: &str) {
    let text = std::fs::read_to_string(root.0.join(path)).unwrap();
    assert!(text.contains(from), "{from} is in {path}");
    root.write(path, text.replacen(from, to, 1).as_bytes());
}

#[test]
fn preparation_presents_own_tree_and_only_the_imported_interface() {
    let root = support::shared_workspace();
    let snapshot = root.snapshot();
    let preparation = snapshot.preparation("consumer.sigil").unwrap();
    let input = snapshot.input();
    let own = |source: &str| source == "consumer.sigil";
    // The consumer's own rows are all there.
    for (field, count) in [
        (
            "units",
            input.units.iter().filter(|u| own(&u.source)).count(),
        ),
        (
            "references",
            input.references.iter().filter(|r| own(&r.source)).count(),
        ),
        ("links", 1),
        ("imports", 1),
    ] {
        assert_eq!(
            preparation[field].as_array().unwrap().len(),
            count,
            "{field}"
        );
    }
    assert!(
        preparation["target"]["text"]
            .as_str()
            .unwrap()
            .contains("Serve the caller.")
    );
    // Of Base, the interface alone: its Facet, its text, its Tags.
    let dependency = &preparation["dependencies"][0];
    assert_eq!(dependency["source"], "base.sigil");
    let units = dependency["units"].as_array().unwrap();
    assert_eq!(units.len(), 1);
    assert_eq!(units[0]["id"], support::base_interface());
    assert!(
        units[0]["text"]
            .as_str()
            .unwrap()
            .contains("A *value* and *result* exist.")
    );
    assert!(!dependency["interfaceHash"].as_array().unwrap().is_empty());
    let mut entities: Vec<&str> = preparation["entities"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["source"] == "base.sigil")
        .map(|e| e["label"].as_str().unwrap())
        .collect();
    entities.sort();
    assert_eq!(entities, ["Base", "result", "value"]);
    let rendered = preparation.to_string();
    for private in [support::base_goal(), support::base_constraints()] {
        assert!(!rendered.contains(private), "{private}");
    }
    assert!(!rendered.contains("Own provider vocabulary."));
    assert!(!rendered.contains("Preserve value and result."));
}

#[test]
fn a_dependency_private_edit_leaves_the_preparation_and_binding_untouched() {
    let root = support::shared_workspace();
    let before = root.snapshot();
    edit(
        &root,
        "base.sigil",
        "Preserve value and result.",
        "Preserve both.",
    );
    let after = root.snapshot();
    assert_eq!(
        before.binding("consumer.sigil").unwrap(),
        after.binding("consumer.sigil").unwrap()
    );
    assert_eq!(
        before.preparation("consumer.sigil").unwrap(),
        after.preparation("consumer.sigil").unwrap()
    );
}

#[test]
fn structural_changes_invalidate_prepared_binding() {
    let first = support::shared_workspace()
        .snapshot()
        .binding("consumer.sigil")
        .unwrap();
    for (field, from, to) in [
        (
            "link",
            "(./notes.md)",
            "(./notes.md \"additional interpretation evidence\")",
        ),
        ("selection", "import { value, result }", "import { value }"),
    ] {
        let root = support::shared_workspace();
        edit(&root, "consumer.sigil", from, to);
        assert_ne!(
            first,
            root.snapshot().binding("consumer.sigil").unwrap(),
            "{field}"
        );
    }
}

#[test]
fn compilation_carries_descriptive_relations_without_turning_imports_into_calls() {
    use sigilc::{
        design,
        eqval::{DesignState, Limits},
        store::{LockedStore, StoreLimits},
        turtle::{self, TurtleLimits},
    };
    let root = support::shared_workspace();
    let snapshot = root.snapshot();
    let mut store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    for source in &snapshot.input().sources {
        let mut body = "@prefix s: <https://sigil.dev/ontology/1#> .\n".to_owned();
        for unit in snapshot
            .input()
            .units
            .iter()
            .filter(|u| u.source == source.path)
        {
            let owner = unit.owner.as_deref().unwrap();
            body.push_str(&format!("<{owner}> s:uses <{owner}> . <{}> a s:Contract; s:from <{owner}>; s:relation \"uses\"; s:target <{owner}>; s:expected true .\n", unit.id));
        }
        let facts = turtle::parse(body.as_bytes(), TurtleLimits::default()).unwrap();
        let binding = snapshot.binding(&source.path).unwrap();
        let prepared = store.prepare(binding.clone()).unwrap();
        store.publish(&prepared, &binding, &facts).unwrap();
    }
    let report = design::compile(&snapshot, &store, Limits::default(), false).unwrap();
    assert_eq!(report.world.state, DesignState::Coherent);
    let structure = report.world.structure.as_ref().unwrap();
    let input = snapshot.input();
    for (field, count) in [
        ("imports", input.imports.len()),
        ("groups", input.groups.len()),
        ("introductions", input.introductions.len()),
        ("references", input.references.len()),
        ("links", input.links.len()),
        ("units", input.units.len()),
    ] {
        assert_eq!(structure[field].as_array().unwrap().len(), count, "{field}");
    }
    assert!(
        !report.world.closure.tables["known"]
            .iter()
            .any(|r| r[1] == "dependsOn" || r[1] == "invokes")
    );
}

#[test]
fn scoping_to_the_consumer_keeps_the_provider_and_its_bindings() {
    let root = support::shared_workspace();
    let (mut input, basis) = root.load();
    let scope: Scope = serde_json::from_value(json!({"version":1,"design":{"paths":["consumer.sigil"]},"implementation":{"paths":[],"allowEmpty":true}})).unwrap();
    scope.resolve(&root.0, &mut input).unwrap();
    let scoped = DesignSnapshot::new(input, basis).unwrap();
    assert_eq!(scoped.input().references.len(), 4);
    assert_eq!(scoped.input().links.len(), 1);
    assert_eq!(
        scoped.binding("consumer.sigil").unwrap(),
        root.snapshot().binding("consumer.sigil").unwrap()
    );
}

#[test]
fn frontend_implementation_locations_retain_captured_source_digest() {
    use sigilc::{
        design,
        eqval::Limits,
        report,
        store::{LockedStore, StoreLimits},
    };
    let root = support::shared_workspace();
    let (mut input, basis) = root.load();
    let diagnostic: Value = json!({
        "code": "OWNERSHIP_UNKNOWN_TAG", "message": "Unknown Tag", "severity": "warning",
        "stage": "host", "filePath": "implementation.ts", "related": [],
        "sourceDigest": "a".repeat(64),
        "implementationRange": {"start": {"line": 1, "column": 1}, "end": {"line": 1, "column": 4}}
    });
    input.diagnostics = vec![serde_json::from_value(diagnostic).unwrap()];
    let snapshot = DesignSnapshot::new(input, basis).unwrap();
    let store = LockedStore::open(&root.0, StoreLimits::default()).unwrap();
    let compiled = design::compile(&snapshot, &store, Limits::default(), false).unwrap();
    let diagnostics = report::design(snapshot.input(), &compiled.world, &[], &Default::default());
    let finding = diagnostics
        .items
        .iter()
        .find(|f| f.code == "OWNERSHIP_UNKNOWN_TAG")
        .unwrap();
    assert_eq!(
        finding.locations[0].source_digest.as_deref(),
        Some("a".repeat(64).as_str())
    );
    assert_eq!(finding.locations[0].coordinate_system, "utf16-lines");
}
