# Alignment loop fixture

These cases specify agent behavior; their presence is not an observed pass. For
each case, copy the complete installed skill bundle and its siblings outside the
checkout. Materialize only that case's raw fenced inputs at the named paths in a
fresh disposable workspace. Give a fresh agent the request, selected sources,
and actual tool availability. Keep host events and observer notes out of its
prompt. Record the input and skill identities, agent trace, edits, checks, final
response, and host limits. Cases are independent.

## A. Repair stale search results

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Align its
implementation and run the relevant test. The workspace is writable; native
comparison is unavailable.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export type Search = (query: string) => Promise<string[]>;

export class SearchPanel {
  visible: string[] = [];
  private activeRequest = 0;

  constructor(private readonly search: Search) {}

  async submit(query: string): Promise<void> {
    this.activeRequest++;
    const results = await this.search(query);
    this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("shows results", async () => {
  const panel = new SearchPanel(async () => ["current"]);
  await panel.submit("query");
  if (panel.visible[0] !== "current") throw new Error("missing results");
});
```

## B. Preserve a valid implementation choice

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Review the code and
tests. No code change is requested if the implementation already fulfills the
contract. Native comparison is unavailable.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  private active = 0;
  private cache = new Map<string, string[]>();
  visible: string[] = [];

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    const results = this.cache.get(query) ?? await search(query);
    this.cache.set(query, results);
    if (request === this.active) this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("latest request publishes", async () => {
  const panel = new SearchPanel();
  let finishOld!: (value: string[]) => void;
  const old = panel.submit("old", () =>
    new Promise((resolve) => {
      finishOld = resolve;
    }));
  await panel.submit("new", async () => ["new"]);
  finishOld(["old"]);
  await old;
  if (panel.visible[0] !== "new") throw new Error("stale publication");
});
```

## C. A policy decision with a source change during handoff

### Request

Use `$sigil-align` for ExportArchive in `archive/export.sigil`. Repair code
defects determined by the accepted contract. If a consequential retention choice
remains, return it with a resumable handoff. The linked policy is locally
readable. Native comparison is unavailable.

### `archive/export.sigil`

```sigil
component ExportArchive {
  goal {
    Keep *completed exports* available for later download.
  }
  constraints {
    Only authorized users may download completed exports.
    Delete expired completed exports under the adopted [retention policy](../policy/retention.md).
  }
  interface {
    Let authorized users download retained completed exports.
  }
  decisions {
    The retention duration awaits a product decision.
  }
}
```

### `policy/retention.md`

```text
No retention duration has been adopted. Seven days and thirty days are under
consideration. Duration changes how long users can recover completed exports.
```

### `archive/export.ts`

```ts
export class ExportArchive {
  private completed = new Map<
    string,
    { content: string; completedAt: number }
  >();

  add(id: string, content: string, completedAt: number): void {
    this.completed.set(id, { content, completedAt });
  }

  download(id: string, authorized: boolean): string | undefined {
    return this.completed.get(id)?.content;
  }

  expire(now: number): void {
    for (const [id, item] of this.completed) {
      if (now - item.completedAt >= 7 * 24 * 60 * 60 * 1000) {
        this.completed.delete(id);
      }
    }
  }
}
```

### `archive/export_test.ts`

```ts
import { ExportArchive } from "./export.ts";

Deno.test("authorized download", () => {
  const archive = new ExportArchive();
  archive.add("one", "data", 0);
  if (archive.download("one", true) !== "data") {
    throw new Error("missing export");
  }
});
```

### Host event after first decision handoff (observer only)

Replace `policy/retention.md` with the following bytes before delivering a
product-owner answer that says “use seven days” in response to the old handoff:

```text
Adopted policy: retain completed exports for thirty days after completion,
then delete them automatically. Downloading does not reset expiry.
```

Observe whether the agent reads the current policy and reconciles the stale
answer with that newly adopted source before any Sigil revision. The host event
tests resumption; the initial agent must not see these observer instructions.

## D. Follow behavior across files despite an ownership annotation

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Review the selected
behavior through its helpers and tests. Native comparison is unavailable.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
// @sigil implements search/panel.sigil::SearchPanel interface,constraints
import { publish } from "./publication.ts";

export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    publish(this, await search(query), request);
  }
}
```

### `search/publication.ts`

```ts
export function publish(
  panel: { visible: string[] },
  results: string[],
  _request: number,
): void {
  panel.visible = results;
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("publishes a completed search", async () => {
  const panel = new SearchPanel();
  await panel.submit("x", async () => ["x"]);
  if (panel.visible[0] !== "x") throw new Error("missing results");
});
```

## Observer notes

- **A:** Identify the active-request constraint and the late-response assignment
  as a confirmed material drift. Fix publication, add a focused ordering test,
  run the relevant test, and report actual results without asking approval.
- **B:** The cache and lack of cancellation are valid choices. Do not demand
  Sigil detail, report drift, or edit code solely because either is present.
- **C:** Fix unauthorized download and test it before returning the retention
  decision. Do not silently adopt the seven-day code policy as contract truth.
  The handoff needs selected scope, exact current source identities, repairs,
  checks, alternatives, and remaining decision. After the host event, the old
  handoff is stale: reread the policy and reconcile the conflict before using
  the answer or invoking `sigil-write` and its independent design review.
- **D:** Follow `publish` into the unannotated helper, repair stale publication,
  add a focused regression test, and report that the annotation alone did not
  establish conformance.

For every case, distinguish observed code behavior, test results, and
unavailable native comparison. An observer should verify the trace, not infer
success from the final prose or fixture text.

## E. Fresh scoped comparison with separate interpretations

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Review its code and
test, run the relevant test, and use the available `sigil export design` and
`sigilc` to compare current Design and Implementation projections. Fresh
separate interpreter children are available. Report the actual native state,
freshness, effective scope, and limits.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    const results = await search(query);
    if (request === this.active) this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("only active request publishes", async () => {
  const panel = new SearchPanel();
  let finishOld!: (results: string[]) => void;
  const old = panel.submit("old", () =>
    new Promise((resolve) => {
      finishOld = resolve;
    }));
  await panel.submit("new", async () => ["new"]);
  finishOld(["old"]);
  await old;
  if (panel.visible[0] !== "new") throw new Error("stale result published");
});
```

### `scope.json`

```json
{
  "version": 1,
  "design": { "paths": ["search/panel.sigil"] },
  "implementation": { "paths": ["search/panel.ts"] }
}
```

## F. A changed source invalidates prepared Implementation evidence

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Repair determinate
code drift, run the focused test, and use available `sigil export design` and
`sigilc` with fresh separate interpreters for native comparison. Report the
state actually established after all current checks.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    this.active++;
    this.visible = await search(query);
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("shows results", async () => {
  const panel = new SearchPanel();
  await panel.submit("one", async () => ["one"]);
  if (panel.visible[0] !== "one") throw new Error("missing results");
});
```

### `scope.json`

```json
{
  "version": 1,
  "design": { "paths": ["search/panel.sigil"] },
  "implementation": { "paths": ["search/panel.ts"] }
}
```

### Host event after Implementation prepare (observer only)

After `sigilc prepare implementation` has written its captured `source` and
binding, but before its Turtle is ingested, change a comment or whitespace in
`search/panel.ts` without changing behavior. Retain the original prepared
directory and the current file bytes as evidence. This forces a source-binding
freshness failure; do not tell the interpreter about the event or edit its
prepared inputs. If the agent has already ingested, apply the edit immediately
before compare and inspect the resulting stale status. The tested agent must see
the changed workspace through its normal checks, not through this note.

## G. Native comparison unavailable after code inspection

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Inspect the code and
test and run the relevant test. This host has no compatible `sigilc` binary or
fresh interpreter children. Report precisely what code and test evidence
supports and why native comparison is unavailable.

### `search/panel.sigil`

```sigil
component SearchPanel {
  goal {
    Show *search results* for the current query.
  }
  constraints {
    Only the active request may publish search results.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  visible: string[] = [];
  private active = 0;

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    const request = ++this.active;
    const results = await search(query);
    if (request === this.active) this.visible = results;
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("current result publishes", async () => {
  const panel = new SearchPanel();
  await panel.submit("one", async () => ["one"]);
  if (panel.visible[0] !== "one") throw new Error("missing results");
});
```

## H. Tag import broadens Design scope without a runtime call

### `.sigil/config.json`

```json
{
  "sigilVersion": "0.9.0",
  "workspace": { "name": "alignment-fixture", "members": [] },
  "files": { "include": ["**/*.sigil"], "exclude": [] },
  "tools": {}
}
```

### Request

Use `$sigil-align` for SearchPanel in `search/panel.sigil`. Inspect relevant
code and tests and run native scoped comparison with the available tools and
fresh separate interpreters. Report the effective Design and Implementation
membership and any actual code dependency supported by evidence.

### `search/service.sigil`

```sigil
component SearchService {
  goal {
    Define the records returned for a query.
  }
  state {
    *search results* are the records matching a query.
  }
  interface {
    Name search results for consumers.
  }
}
```

### `search/panel.sigil`

```sigil
@search/service.sigil from SearchService import { search results }

component SearchPanel {
  goal {
    Show search results for the current query.
  }
  interface {
    Display search results for the current query.
  }
}
```

### `search/panel.ts`

```ts
export class SearchPanel {
  visible: string[] = [];

  async submit(
    query: string,
    search: (q: string) => Promise<string[]>,
  ): Promise<void> {
    this.visible = await search(query);
  }
}
```

### `search/panel_test.ts`

```ts
import { SearchPanel } from "./panel.ts";

Deno.test("displays supplied search results", async () => {
  const panel = new SearchPanel();
  await panel.submit("one", async () => ["one"]);
  if (panel.visible[0] !== "one") throw new Error("missing results");
});
```

### `scope.json`

```json
{
  "version": 1,
  "design": { "paths": ["search/panel.sigil"] },
  "implementation": { "paths": ["search/panel.ts"] }
}
```

## Native case observer notes

- **E:** Inspect the actual `sigil export design` capture, `sigilc scope`
  effective membership, both stale reports, Design preparation and ingest,
  current catalog, Implementation preparation and ingest, and structured compare
  output. Retain distinct child requests and outputs, input and binding digests,
  host read-only enforcement status, test result, and final report. A named
  `Closed` state is valid only if this run's structured output supports it and
  code inspection leaves no material gap. Do not prescribe Turtle or a native
  verdict to either interpreter.
- **F:** The original source binding must fail ingest or be marked stale after
  the host edit. Observe a fresh prepare and interpretation for current bytes,
  or an explicit incomplete-native-evidence handoff if that cannot finish. A
  `Converged` result with unresolved obligations, a stale report, or a previous
  `Closed` result cannot be promoted to current closure. The agent still repairs
  and tests the original stale-result defect.
- **G:** Code inspection and tests continue. The native state is unavailable,
  with the actual missing prerequisites named; a passing test does not imply a
  native state or full alignment.
- **H:** `scope.design.sources` should include both `search/panel.sigil` and
  `search/service.sigil` through the import, while the selected Implementation
  membership remains `search/panel.ts`. The import supplies a Tag and broader
  Design comparison coverage; it does not by itself prove a runtime call to
  SearchService. Record the actual scope output and code path before making a
  dependency finding.

Run native cases against the real binaries and actual independent children in
disposable workspaces. Keep these observer notes and host events out of agent
inputs. Preserve any incomplete trace as incomplete; these fixtures do not
assert a native verdict before interpretation and comparison occur.
