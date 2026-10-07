# Slotted interpretation benchmark

The benchmark runs Sigil's computed-claims evaluation against the seven-source
Slotted design. It starts a fresh Claude, Codex, or Pi process for every
source/pass attempt, validates the ingested claims, and writes a report from the
saved evidence.

The benchmark owns the Slotted fixture and its four planted problems in
[`fixture.ts`](./fixture.ts). It checks their evidence against the captured
design before scheduling a batch. If the design has drifted, the report marks
the affected planted-problem measure as unavailable.

A source is read with its imports shown as interface only. The
`booking-rooms-archived-mark-ownership` problem depends on Rooms' `state`
section, which Booking no longer sees, so the preflight marks it as drift and
the report shows its measure as unavailable. The other three problems stay
scorable.

## Requirements

- Deno and Rust/Cargo must be available.
- The Claude, Codex, or Pi CLI you select must be installed and authenticated.
- Each model selector must be accepted by its selected CLI.

The `deno task slotted-benchmark` command builds `sigilc` and `sigil-claims`
with Cargo before running the benchmark.

Every command reads the Slotted workspace with `--root` and keeps its readings
in a private `--store` that must start empty. An attempt therefore never reuses
an earlier reading.

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

Each selected pair gets seven source attempts per pass. The runner processes
attempts sequentially and gives each one a fresh child process and an empty
private claims store. The default timeout is 180,000 ms per source attempt. It
covers preparation, interpretation, and ingest. Set a different budget with
`--timeout-ms`:

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
invalid, interrupted, and unfinished attempts. A stopped batch keeps its
completed and pending attempt records so its report can be rebuilt later.

## Read or rebuild a report

Every batch contains a `report.md` with these sections:

- **Runs:** one row per scheduled source attempt, including agent, requested and
  observed model, pass, status, state, planted findings, additional findings,
  Facet coverage, and evidence links.
- **Agent and model comparison:** rows grouped by agent, model identity, and
  source. The table reports state counts, planted-problem detection,
  additional-finding frequencies, and Facet coverage. It does not assign one
  overall rank.
- **Planted finding evidence, additional findings for review, and variation:**
  evidence links for matched planted problems, extra findings that need human
  review, and Facet rows that differ across valid repeated attempts.

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
raw host events, native claims reports and contexts, and one record per
scheduled attempt. The children do not receive the planted-problem answer key or
prior batch output.

See [`report.ts`](./report.ts) for report definitions and
[`docs/computed-evaluation-demo.md`](../../docs/computed-evaluation-demo.md) for
the current demo workflow and historical manual results.
