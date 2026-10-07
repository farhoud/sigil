# Computed evaluation orchestration contract

This is the shared protocol for running the claims loop on one selected Sigil
0.9 design source. The host owns the loop: it runs the tool, keeps one
preparation, delegates one interpretation, and recognizes one completed result.
The tool never launches a model and never reads skills. The interpreter child
only reads the prepared request and returns rows. The host supplies agent
creation, cancellation, and any enforced restrictions; run records belong
outside the design workspace under validation.

Advisory design review is a different job, kept by `sigil-evaluate`. This loop's
only outputs are the ingest state and the findings report.

## The tool surface

```text
sigil-claims prepare --source PATH --out NEW_DIR [--root DIR] [--store DIR]
sigil-claims ingest --binding FILE --claims FILE|- [--claims-repeat FILE|-] [--root DIR] [--store DIR]
sigil-claims check [--source PATH] [--root DIR] [--store DIR]
sigil-claims extract-guidance --out DIR [--root DIR]
```

`--root DIR` is the workspace, read directly (default `.`). `--store DIR`
holds stored readings and reports (default `<root>/.sigil`). There is no
export step.

Exit codes: `0` is a pass or warning; `1` is a gate failure — a computed
Disjoint verdict, an `incomplete` linked check, a refused artifact, or a
saturation-limit breach; `2` is a
usage error, including a binding that no longer matches the workspace; `3`
is an operational failure such as an unreadable input. Exit 1 alone is never a
verdict: a refused artifact exits 1 with an error message and no structured
result, and only the result below plus its matching report decide a state.

`check` reads the root and the store directly, with no preparation or binding.
It links every valid stored reading of the workspace into one program and runs
every claims law over it, without launching a model. `--source PATH` only
filters the findings to those that source authored; the `unread` and
`unresolvedImports` lists stay workspace-wide.

Prepare writes into a fresh, initially empty preparation directory — it
refuses one that is not empty — the files `binding.json`, `request.json`, and
the guidance bundle (`sections.md`, `vocabulary.md`, `examples.md`,
`rejected.md`). Its structured result names the binding path, the written
inputs, and counts: `facets` presented, `requestedUnits` to read,
`reusedUnits` taken from stored interpretations, `regroundedUnits` kept after a
change that did not alter them, and `uninterpretedContext` rows shown for
reference. It also names `bindingDigest` and `workspaceDigest` (the hash of
every resolved tree id). The binding carries `format`, `source`,
`sourceContent`, `interfaces` (each imported component's interface hash),
`guidanceFingerprint`, `vocabularyGeneration`, and `facets`: the identity of
the request, which ingest recomputes and compares. A mismatch names the field
that moved.

Check prints a structured result with `version`, `scope`, `state`,
`findings`, `unreadUnits`, `unresolvedImports`, `report`, `judgmentContext`,
`workspaceDigest`, `vocabularyGeneration`, and `guidanceFingerprint`. Its state
adds `incomplete`: some unit has no valid reading, or an import does not
resolve. The report (version 4) lists `unread` units by source, component,
section, and Facet ids, and `unresolvedImports`. It is written to
`<store>/claims/workspace.linked.json`, or `<store>/claims/<source>.linked.json`
with `--source`, with a matching `.linked.context.json`; ingest's files are
never overwritten. `incomplete` and `disjoint` exit 1; `loose` and `coherent`
exit 0. Ingest never emits `incomplete`.

Stored interpretations live under `<store>/claims/interpretations`. The
findings report and the judgment context are written under `<store>/claims`.

Ingest prints a structured result with `version`, `source`, `state`,
`findings` (a count), `report` (the path it just wrote), `judgmentContext`,
`vocabularyGeneration`, and `guidanceFingerprint`. States serialize lowercase:
`coherent`, `loose`, `disjoint`. The report file carries `version`, `source`,
`identity` (`bindingDigest`, `interpretations`, `guidanceFingerprint`,
`vocabularyGeneration`), `state`, `iterations`, `findings`, and optional
`disagreements`. Each finding carries `class` (`contradiction`,
`ownership-conflict`, `unmet-obligation`, `interpretation`, or `flow`), `law`,
`subject`, `object`, `claims`, `component`, `section`, and `detail`.

## Select one exact source

Resolve the selected source before prepare, from the workspace's sources:
`sigilc tree --root .` lists each as `parse.path`.

- Honor an explicit source, and honor a design already selected
  unambiguously in the conversation.
- Otherwise use the sole eligible source in the workspace. If several remain,
  ask which one before prepare — a question to the requester, not a tool run.
- Resolve the requested source to the exact workspace-relative path; never
  match by an arbitrary basename.
- An explicitly selected source absent from the workspace is a failure: name it
  and stop. It is not permission to choose another source.

Dependencies are the tool's. Prepare shows the selected source's imports as
interface context only (rows marked `context`); the host does not widen or
narrow them, reconstruct them, or substitute a workspace-wide reading for the
selected source's coverage. The one-source loop's ingest sees a flow that
crosses components only when the dependency's interface states it. The linked
`check` also sees the dependency's stored private readings, which the child
never reads; the full-design action below is the loop that runs it.

## Keep one preparation and a private store

One run uses one preparation and a private claims store.

- Retain inputs in a unique run directory outside the design workspace, with a
  fresh, initially empty preparation directory inside it.
- Before prepare, copy any existing workspace
  `.sigil/claims/interpretations/` into `claims/interpretations/` under a
  private store directory in the run directory. An absent store starts empty.
  Retain the seed as evidence.
- Pass the workspace as `--root` and this same private directory as `--store`
  to both prepare and ingest. Memo writes stay private: in the one-source loop, never merge them back
  into the workspace, and never write to the workspace's own store. The
  full-design action's write-back below is the only exception.
- Retain prepare's structured result: its `bindingDigest` and `workspaceDigest`
  identify what the result covers.

Ingest recomputes the request from the live workspace. If the selected source
or an imported interface changed after prepare, ingest refuses the binding and
names the field that moved; the host stops rather than re-preparing. Edits to
other files do not matter. The result handoff carries the binding digest so a
reader can tell what the state covers.

## The full-design action

The full-design action reads every source that still has unread units, then
links the whole workspace. It is an alternative to the one-source loop and
follows the same rules for the private store, the child handoff, and
recognizing a completed ingest, per source. `sigil-claims` still launches no
model; the host orchestrates every reader.

1. Seed the private store from the workspace's
   `.sigil/claims/interpretations/`, as above, and retain the seed as
   evidence. Keep a copy of it to compare against at the end.
2. Run `check` with the workspace as `--root` and the private store as
   `--store`. Its `unread` list is the work queue: group it by source. A
   check that already reports a state with nothing unread and no unresolved
   import needs no reader.
3. For each source in the queue, run prepare into a fresh empty preparation
   directory. Launch one fresh child only when prepare reports
   `requestedUnits` greater than zero; otherwise skip the child and the
   ingest for that source. Then ingest the child's captured artifact in the
   private store. Do not repair or retry. A source whose reader, prepare, or
   ingest fails is recorded as failed, and the remaining sources still run.
4. Run `check` again over the same private store. Hand back its state and
   report. When it is `incomplete`, name every failed source and the unread
   units the report lists, and the unresolved imports if any.

A source whose stored reading a dependency's changed interface refused is
unread in step 2, so the run re-reads it once. The next run finds it valid and
launches no reader for it. With no edits since the last full run, the queue is
empty, no reader launches, and the check hands back the same report.

### Write back what the run read

After the final check, copy readings from the private store into the workspace
store. This is the one exception to the private-store rule, and it belongs to
the full-design action alone. For each file under the private store's
`claims/interpretations/`, copy it into the workspace's
`.sigil/claims/interpretations/` when:

- the workspace store lacks it; or
- its bytes differ from the seed taken at the start of the run, and the
  workspace copy still matches that seed.

A re-read unit keeps its old memo key, so copying only absent files would leave
the stale entry in place. Write each copy to a temporary file in the same
directory and rename it into place. A workspace entry that changed since
seeding is left alone. Reports and judgment context are not copied. A run
that stops before the final check writes nothing back.

## Hand one fresh child the prepared request

Interpretation is one fresh child with no inherited conversation. The child
does not run the tool; it reads the prepared request and returns rows.

| Field | Content |
| --- | --- |
| `task` | Read the prepared interpretation request and return data-only rows. This task overrides ordinary explanatory output. |
| `skills` | Resolved installed entrypoint paths of the required `sigil-understand` and `sigil-egglog` skills. |
| `preparation` | The preparation directory, containing the files below. |
| `request` | Path to `request.json`: the presented Facet rows (rows marked `context` are dependency interface shown for reference and take no reading), whole Logic groupings, admissible entities, the components each source imports from, and declared roles. |
| `binding` | Path to `binding.json`, the request's identity. |
| `guidance` | Paths of every guidance file prepare wrote. The prepared guidance is binding for row shapes and accepted names. |
| `artifact` | Where the host will read the returned rows. |
| `completion` | The child states it finished. For a request that presents nothing, that statement says the returned artifact is empty on purpose. |

The child loads `sigil-understand` for design meaning and `sigil-egglog` for
the claims dialect; neither replaces the request's binding guidance. Capture
the completed artifact verbatim and pass those exact bytes to ingest. Do not
repair rows, strip prose, or substitute host interpretation. Preserve whole
Logic groupings as presented, and do not reconstruct Facets prepare omitted.

Even a request whose every unit was reused from the store — one that presents
zero rows — goes through one fresh child, which returns an explicitly
completed empty artifact. Missing delegation, a missing required skill, or
interrupted output is a failure, not rows.

## Recognize a completed ingest

A completed ingest is all of:

1. Exit 0 with a structured result whose state is `coherent` or `loose`, or
   exit 1 with a structured result whose state is `disjoint`. A linked
   `check` also completes on exit 1 with state `incomplete`.
2. The result is this invocation's payload — not a bare exit code, and not a
   file left by an earlier run.
3. The report named by the result matches the preparation: `source` is
   the selected source; `state` equals the result's state; the report version
   is the one the result names; `identity.bindingDigest` equals the
   `bindingDigest` prepare returned — the tool's binding digest, never a hash
   of raw file bytes in its place; `identity.guidanceFingerprint`
   and `identity.vocabularyGeneration` equal the binding's (and the
   result's); and `identity.interpretations` records the digest of the exact
   artifact bytes supplied, in the order supplied. That digest is the tool's
   BLAKE3 over the captured artifact: retain the captured bytes, and when you
   can compute the same digest over them, require the match.
4. The result's `report` and `judgmentContext` paths lie under this run's
   private store. The tool defaults `--store` to `<root>/.sigil`, so a
   dropped or mistyped flag still produces a fully consistent report written
   somewhere else; this check is what catches it.

For a linked `check`, the same rules apply with the check's result: the
report's `scope` and `state` equal the result's, its `identity` carries the
`workspaceDigest`, `guidanceFingerprint`, and `vocabularyGeneration` the
result names, and both paths lie under the private store.

Anything else — a bare exit code, an old report, a malformed payload, a
mismatch, or an operational failure — supplies no design state. Retain the
matched report under the private store. Identity checks do not identify memo
contents; the private store per run is what keeps invocations separate.

## Stop on the real failure

When any step cannot finish — the tool is missing, the source
is absent, the artifact is refused, the child is missing or interrupted, the
payload is malformed, or the report does not match — stop. Name what broke and
which step broke it. Emit no Coherent, Loose, or Disjoint. Do not retry the
child and do not rerun the loop; the requester sees the real failure. In the full-design action, one source's
failure is recorded and does not stop the other sources; the final check still
runs and names the failed source.

## Hand back the result

After a completed ingest, hand back:

- The ingest state, presented as Coherent, Loose, or Disjoint. For the
  full-design action, the check's state, which may also be Incomplete, with
  its `unread` units, `unresolvedImports`, and any failed source named. An
  incomplete check is not a pass.
- The findings of the matched report, with their class, law, claims,
  component, section, and detail. Flow-class findings are warnings and never
  by themselves make Disjoint.
- The selected source, and the preparation identity: the binding digest, the
  workspace digest, and the seeded store the result describes.

Comparison states — Drift, Converged, Closed — are not this loop's states and
must not appear as one. The state is the selected source's; a source reached
only as an import is context, not a covered design.

## Boundaries

This loop evaluates an existing Sigil 0.9 design. It does not author, revise,
or delete design files, and a 0.7 contract or a greenfield design is not its
input. `sigil-write` still delegates its review to `sigil-evaluate`; this
skill is not the writer's reviewer. The claims binary does not read skills:
`sigil-understand` and `sigil-egglog` stay host-loaded for the child, as
[design-language authority](../../sigil-understand/SKILL.md) and
[claims-dialect background](../../sigil-egglog/SKILL.md).
