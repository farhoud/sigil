//! The deterministic command boundary. No process launchers or model options.
pub use crate::command::{Output, read, store_dir};
use std::path::Path;

pub fn run(args: &[&str]) -> Output {
    if args.first() == Some(&"tree") {
        return crate::tree::command::run(&args[1..]);
    }
    if args.first() == Some(&"clean") {
        let (root, store) = match args {
            ["clean"] => (".", None),
            ["clean", "--root", root] => (*root, None),
            ["clean", "--store", store] => (".", Some(*store)),
            ["clean", "--root", root, "--store", store]
            | ["clean", "--store", store, "--root", root] => (*root, Some(*store)),
            _ => return Err((2, "Usage: sigilc clean [--root DIR] [--store DIR]".into())),
        };
        let store = store_dir(Path::new(root), store);
        let removed =
            crate::store::clean_in(Path::new(root), &store).map_err(|message| (3, message))?;
        let output = serde_json::to_string_pretty(&serde_json::json!({
            "version": 2, "removed": removed
        }))
        .map_err(|error| (3, error.to_string()))?;
        return Ok((0, output + "\n"));
    }
    Err((2, "Invalid command or options. Run sigilc --help.".into()))
}
