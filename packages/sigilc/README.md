# sigilc

`sigilc` is the native Sigil compiler and computed design checker. It reads
workspace sources, accepts externally interpreted data-only egglog rows, and
links stored readings to report coherent, loose, disjoint or incomplete designs.
The tool never launches models or workers.

Build with Rust 1.91.1 or newer:

```sh
cargo build --locked --manifest-path packages/sigilc/Cargo.toml
```

`--root DIR` names the workspace (default `.`); `--store DIR` names the store
(default `<root>/.sigil`). The tool reads workspace configuration, glossary and
design sources directly.

```sh
sigilc prepare --root . --source architecture/a.sigil --out reading-a
# An external interpreter reads reading-a and writes answer.egg.
sigilc ingest --root . --binding reading-a/binding.json --claims answer.egg
sigilc check --root .
sigilc extract-guidance --root . --out /tmp/sigil-guidance
```

Prepare asks only for stale or unread units. The binding captures the source,
imported interfaces, vocabulary and guidance. Ingest refuses mismatched inputs
and records admitted readings under `claims/interpretations/`. Check links all
stored readings and runs the design laws. `check --source PATH` narrows the
reported findings while checking completeness across the workspace.

Design reports have version 5. Exits are 0 for coherent or loose, 1 for disjoint
or incomplete and refused readings, 2 for usage, and 3 for operational failure.
Reports and judgment contexts live under `claims/` in the chosen store.

## Trees, content ids, and dependencies

`sigilc` turns each `.sigil` file into a content-addressed tree: components,
sections, and Facets, each with an id made from its content. A Facet id is
`facet:<hash>`; it does not change when the file is reformatted or when
unrelated text moves, and it changes when the Facet's meaning changes. Callers
that need a unit or entity id read it from `sigilc tree`.

```sh
sigilc tree --root . [--source PATH] [--diff]
```

`tree` prints the resolved trees as deterministic JSON: per source, its
components, interface Tags, resolved Tags with their IRIs, and Facets with
ranges, prose, and links. `--diff` lists the Facets added, removed, and changed
since the previous tree recorded for each source.

A dependency is presented to its importers by its interface only. A component
sees what a provider declares in its `interface` section and nothing from the
provider's private sections or logic. A flow that crosses components must
therefore be stated in the dependency's interface; editing a dependency's
private sections does not change its importers.

`sigilc clean` removes generated `worlds/` and `trees/` caches from the store,
preserving stored claims readings, authored sources, configuration and caller
preparations. Version 0.3.0 retires Turtle worlds and their commands.
