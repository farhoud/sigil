# Optional native comparison for one Component

Use this path when a compatible Sigil 0.9 `sigil export design` and `sigilc` are
available and the host can supply two fresh, separate interpreters. Check
compatibility against the current structural export with `sigilc scope`; a
version string alone does not establish it. If an installed `sigilc` rejects the
export but a checkout binary accepts it, use the checkout binary throughout this
run and record its path. The alignment agent owns capture, scope, preparation,
ingest, and comparison. `sigilc` validates and compares supplied Turtle
projections; it does not run interpreters, inspect tests, or certify that a
projection faithfully describes its source. Continue code review and determinate
repair when this path is unavailable, and say why native evidence could not be
established.

## Capture one current scope

Select the reviewed Component's exact owning Sigil source as the Design root.
Choose the relevant Implementation files by following actual behavior and tests;
an annotation or Tag import alone does not determine code membership. Write an
explicit version-1 `scope.json`, for example:

```json
{
  "version": 1,
  "design": { "paths": ["search/panel.sigil"] },
  "implementation": { "paths": ["search/panel.ts", "search/publication.ts"] }
}
```

Use one workspace root, captured structural frontend, and scope file through
scope inspection, both sides' stale checks, every prepare and ingest, and the
final compare. Pass the same `--root`, `--frontend`, and `--scope` values on
those commands. Do not mix `--scope` with `--selection` or `--allow-empty`;
intentional emptiness belongs in the scope JSON. Place captures, preparation
directories, and Turtle outputs outside authored Sigil and source discovery.

```sh
sigil export design . > frontend.json
sigilc scope --root . --frontend frontend.json --scope scope.json
sigilc stale design --root . --frontend frontend.json --scope scope.json
```

Check the export and scope report before delegating. Record the workspace root,
captured frontend and scope file digests, selected Design root,
`design_input_fingerprint`, `implementation_source_fingerprint`,
`scope.design.sources`, `scope.design.dependencies`,
`scope.design.conservative_full_bundle`, `scope.implementation_sources`, and the
membership and order fingerprints. Design membership expands imported providers
and owners; an unresolved import can conservatively include the whole Design
bundle. The Implementation selection independently discovers files. Report
effective membership as comparison coverage, not as proof that every member is a
runtime dependency of the selected Component. A Tag import may broaden Design
closure without a runtime call.

## Prepare independent interpretations

Inspect each stale report's structured source statuses. Prepare a fresh
projection for every missing, stale, or dependency-invalid selected source;
reusing a fresh stored projection is permitted only while its binding remains
current. Give each Design source a fresh preparation directory:

```sh
sigilc prepare design --root . --frontend frontend.json --scope scope.json --source search/panel.sigil --out /tmp/design-panel
# Fresh Design interpreter reads design.json and ontology.json, then returns Turtle.
sigilc ingest design --root . --frontend frontend.json --scope scope.json --source search/panel.sigil --binding /tmp/design-panel/binding.json --turtle /tmp/design-panel/result.ttl
sigilc compile design --root . --frontend frontend.json --scope scope.json
sigilc entities --root . --frontend frontend.json --scope scope.json
```

Repeat prepare and ingest for every effective Design source that needs it. The
Design child receives only its prepared `design.json`, `ontology.json`,
`binding.json`, and the installed Sigil 0.9 understanding authority needed to
interpret them. Start a fresh read-only child for each interpretation, with no
inherited conversation. Retain its exact request and Turtle output. Do not
manufacture Turtle from the compiler's desired result. Verify current Design
freshness and inspect compile diagnostics; a Disjoint or stale Design has no
usable current catalog. `entities` must provide the current provisional or
authoritative catalog before Implementation preparation.

Then inspect Implementation freshness and prepare each selected file that needs
a new projection:

```sh
sigilc stale implementation --root . --frontend frontend.json --scope scope.json
sigilc prepare implementation --root . --frontend frontend.json --scope scope.json --source search/panel.ts --out /tmp/implementation-panel
# Separate fresh Implementation interpreter reads only source, ontology.json,
# catalog.json, and binding.json, then returns Turtle.
sigilc ingest implementation --root . --frontend frontend.json --scope scope.json --source search/panel.ts --binding /tmp/implementation-panel/binding.json --turtle /tmp/implementation-panel/result.ttl
sigilc compare --root . --frontend frontend.json --scope scope.json
```

Repeat for every selected Implementation source that needs it. The
Implementation child receives only the captured `source` bytes, `ontology.json`,
`catalog.json`, and `binding.json` written by its prepare command, plus the task
to interpret those inputs as Turtle. Do not give it authored Design prose,
Design promises, the Design child's output or reasoning, neighboring uncaptured
source, or inherited conversation. The catalog supplies identities, not Design
obligations. Never reuse a Design interpreter as an Implementation interpreter.
Record their actual input paths and digests, child identities, requests,
outputs, and whether the host enforced read-only file/tool access or only
instructed the children to be read-only. Do not describe an instruction-only
boundary as enforced isolation.

Keep each prepare result's `binding.json` with its source and returned Turtle.
Record the binding fingerprint and the source and catalog identities it binds.
Ingest checks the current source, ontology, Design dependencies or catalog, and
projection generation against that binding. A rejected ingest supplies no
current projection: recapture or prepare again as indicated, and obtain a new
interpretation. After a Sigil source, linked context, frontend, scope, binding,
catalog, or relevant code change, recheck freshness and reprepare affected
sources before comparison. Refresh the Design catalog before re-preparing
Implementation when Design changes. Never carry an old comparison over a repair.

## Read and report the result

Read this invocation's JSON, including `scope`, `comparison.design`,
`comparison.implementation`, `comparison.freshInputs`, `comparison.unresolved`,
`comparison.disagreements`, and `comparison.implementationContradictions`; also
inspect diagnostics and source freshness. An exit code alone is not a comparison
state: exit 0 can be Converged or Closed, exit 1 can be Drift, and exit 3 can
mean comparison unavailable. A null `comparison`, missing catalog, failed
command, missing child, or incomplete interpretation is unavailable evidence,
with its specific reason.

| Native result | Meaning for the handoff                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Drift`       | A structured disagreement or Implementation contradiction was found. Anchor it to code and contract evidence before repair.                                         |
| `Converged`   | No established contradiction, but Design looseness, stale inputs, or unresolved obligations prevent closure. Do not call the Component Closed.                      |
| `Closed`      | Current coherent Design and fresh Implementation satisfy the supplied native obligations with none unresolved. State the effective scope and interpretation limits. |
| Unavailable   | No established native state. Name the failed prerequisite or step and continue supported code review and repair.                                                    |

Report the structured native state and freshness separately from observed code
behavior, actual test results, and interpretation fidelity. Even `Closed` cannot
prove that source interpretation was complete or that code works as promised. If
code inspection finds missing behavior despite `Converged` or `Closed`, keep the
finding open, repair determinate code drift, refresh the projection, and
reassess. Do not claim full alignment while a material code, test, projection,
or interpretation gap remains.
