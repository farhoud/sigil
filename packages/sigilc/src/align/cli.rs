//! Deterministic implementation interpretation commands.
use super::prepare;
use crate::command::{Output, json, store_dir};
use std::{collections::BTreeMap, path::Path};

pub fn help() -> String {
    "sigilc align — implementation claims\n\nCommands:\n  prepare --out NEW_DIR [--root DIR] [--store DIR]\n\nReads tools.sigilc.implementation from workspace configuration. Each selected\nwhole file is presented in its own directory with names, claims and code guidance.\nThe presentation limit is 1000000 bytes per file. This command launches no model.\n".into()
}

// @sigil implements packages/sigilc/align.sigil::SigilImplementationClaims::AlignCommands interface
pub fn run(args: &[&str]) -> Output {
    if matches!(args, [] | ["--help"] | ["-h"]) {
        return Ok((0, help()));
    }
    let ["prepare", tail @ ..] = args else {
        return Err((2, "Invalid align command. Run sigilc align --help.".into()));
    };
    let mut options = BTreeMap::new();
    let mut remaining = tail;
    while let Some((flag, next)) = remaining.split_first() {
        if !["--out", "--root", "--store"].contains(flag) || options.contains_key(*flag) {
            return Err((2, format!("unknown or duplicate option: {flag}")));
        }
        let Some((value, next)) = next.split_first() else {
            return Err((2, format!("missing value for {flag}")));
        };
        options.insert(*flag, *value);
        remaining = next;
    }
    let out = Path::new(
        options
            .get("--out")
            .ok_or_else(|| (2, "missing required option: --out".into()))?,
    );
    prepare::empty_output(out).map_err(|e| (2, e))?;
    let root = Path::new(options.get("--root").copied().unwrap_or("."));
    let store = store_dir(root, options.get("--store").copied());
    let workspace = prepare::load(root, &store).map_err(prepare::LoadError::output)?;
    let requests = workspace
        .selection
        .implementation
        .files
        .iter()
        .map(|file| workspace.request(root, file))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| (3, e))?;
    let directories = prepare::write(&requests, out).map_err(|e| (3, e))?;
    json(
        0,
        &serde_json::json!({
            "version": prepare::REQUEST_FORMAT,
            "requestedUnits": requests.len(),
            "inputs": directories,
            "namesDigest": workspace.names_digest,
            "selection": workspace.selection,
            "presentationByteLimit": prepare::MAX_FILE_BYTES,
        }),
    )
}
