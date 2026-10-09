use std::{
    io::{self, Write},
    process::ExitCode,
};

fn root_help() -> String {
    r#"sigilc — native Sigil compiler

Commands (every command that reads a workspace takes [--root DIR] [--store DIR]):
  tree [--source PATH] [--diff] [--root DIR] [--store DIR]
  clean [--root DIR] [--store DIR]

--root DIR is the workspace: sigilc reads its .sigil configuration, glossary and
sources directly (default: the current directory). --store DIR holds the tree
cache and claims readings (default: ROOT/.sigil).

`tree` prints the resolved Merkle trees as deterministic JSON, for one source or
every source; --diff prints the Facets added, removed and changed since the
previous tree recorded for each source. `clean` removes generated caches and
preserves claims readings.

Exits: 0 = success; 2 = usage; 3 = operational failure.
"#
    .into()
}

fn main() -> ExitCode {
    match run() {
        Ok((code, output)) => match io::stdout().write_all(output.as_bytes()) {
            Ok(()) => ExitCode::from(code),
            Err(error) => {
                let _ = writeln!(io::stderr(), "{error}");
                ExitCode::from(3)
            }
        },
        Err((code, message)) => {
            let _ = writeln!(io::stderr(), "{message}");
            ExitCode::from(code)
        }
    }
}

fn run() -> sigilc::cli::Output {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let output = match args.as_slice() {
        ["--version"] => format!("sigilc {}\n", env!("CARGO_PKG_VERSION")),
        ["--help"] | ["-h"] => root_help(),
        _ => return sigilc::cli::run(&args),
    };
    Ok((0, output))
}
