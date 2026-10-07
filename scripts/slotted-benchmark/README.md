# Slotted interpretation benchmark

The benchmark runs Sigil's computed-claims evaluation against the seven-source
Slotted design. One **pass** interprets every source into one private store with
a fresh Claude, Codex, or Pi process per source, then runs one linked
`sigil-claims check` over everything that was read. It validates each source's
ingest and the linked report, and writes a report from the saved evidence.

The benchmark owns the Slotted fixture and its four planted problems in
[`fixture.ts`](./fixture.ts). It checks their evidence against the workspace
trees before scheduling a batch. If the design has drifted, the report marks the
affected planted-problem measure as unavailable.

A source is read with its imports shown as interface only, so a model never sees
a dependency's private sections. The linked check does not have that limit: it
links the stored readings of every source, so a problem that spans components,
such as `booking-rooms-archived-mark-ownership` (Booking claims a mark that
Rooms' private `state` says Rooms owns), is scored from the linked report. A
planted problem whose anchor Facets were unread in a pass, for example because
one reader failed, is unavailable for that pass rather than missed, and the
other problems still score.

## Requirements

- Deno and Rust/Cargo must be available.
- The Claude, Codex, or Pi CLI you select must be installed and authenticated.
- Each model selector must be accepted by its selected CLI.

The `deno task slotted-benchmark` command builds `sigilc` and `sigil-claims`
with Cargo before running the benchmark.

Every command reads the Slotted workspace with `--root` and keeps its readings
in a private `--store`. A pass's store must start empty, so a source's own units
are always read for the first time. Within a pass the seven sources share that
store, which is what the linked check reads.

## Run a batch

Pass one `--agent AGENT:MODEL` option for each agent/model pair and choose a
positive pass count:

```sh
deno task slotted-benchmark run \
  --agent claude:MODEL \
  --agent codex:MODEL \
  --agent pi:MODEL \
  --passes 3
```

Replace each `MODEL` with a selector supported by that CLI. For example, Pi
selectors may include a provider such as `provider/model`.

Each selected pair gets one pass per requested pass count. A pass processes the
seven sources sequentially, each with its own prepare, fresh child process,
ingest, and timeout, all into one empty private claims store. After the last
ingest it runs `sigil-claims check --root WORKSPACE --store STORE`. The linked
state is `disjoint` or `incomplete` (exit 1) or `loose` or `coherent` (exit 0);
`incomplete` means some unit had no valid reading. The default timeout is
180,000 ms per source, and per check. It covers preparation, interpretation, and
ingest. Set a different budget with `--timeout-ms`:

```sh
deno task slotted-benchmark run \
  --agent claude:MODEL \
  --passes 2 \
  --timeout-ms 240000
```

By default, each run gets a new directory under
`analyze-demo/slotted-runs/benchmarks/`. Git ignores that directory. To choose a
different destination, pass `--out DIR`; the directory must not already exist.

The command prints the report path and counts for scheduled, valid, failed or
invalid, interrupted, and unfinished passes. A stopped batch keeps its completed
and pending pass records so its report can be rebuilt later.

## Read or rebuild a report

Every batch contains a `report.md` with these sections:

- **Runs:** one row per scheduled pass, including agent, requested and observed
  model, pass, sources read, status, linked state, planted findings (or N/A
  where the anchor Facets were unread), additional findings, Facet coverage, and
  evidence links.
- **Source readings:** one row per source in each pass, with its own ingest
  state and coverage.
- **Agent and model comparison:** rows grouped by agent and model identity. The
  table reports linked state counts, planted-problem detection,
  additional-finding frequencies, and Facet coverage. It does not assign one
  overall rank.
- **Planted finding evidence, additional findings for review, and variation:**
  evidence links for matched planted problems, extra findings that need human
  review, and Facet rows that differ across valid repeated passes.

To rebuild a report from a saved batch without starting an agent:

```sh
deno run --allow-read --allow-write --allow-run --allow-env \
  scripts/slotted-benchmark/main.ts report \
  analyze-demo/slotted-runs/benchmarks/BATCH_DIRECTORY
```

The report uses only evidence inside the batch directory. Requested models are
shown separately from observed model IDs; hosts that do not report a served
model are labeled unverified.

## Retained evidence

Each batch keeps its `sigilc tree` output, the workspace digest, fixture
preflight, tool and guidance identities, prepared requests, exact child rows,
raw host events, each source's claims report and context, the linked report and
context (`workspace.linked.json`), and one record per scheduled pass. The
children do not receive the planted-problem answer key or prior batch output.

See [`report.ts`](./report.ts) for report definitions and
[`docs/computed-evaluation-demo.md`](../../docs/computed-evaluation-demo.md) for
the current demo workflow and historical manual results.
