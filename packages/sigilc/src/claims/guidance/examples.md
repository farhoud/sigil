# One worked Facet per contract role

Facet identities below are written `"f1"`, `"f2"` and so on for readability. In
a real run you copy the identity out of the pre-filled row you were handed.

Entity names are written as they appear in the design. Use the identity the
pre-filled row and the entity list give you, not a name you invent.

## `goal`

> Provide *record search*: find records matching a supplied query.

```
(claim "f1" "SearchService" "provides" "record search" "required" "true")
```

Purpose becomes a capability the component provides. The Facet says what the
component is for, so the commitment is `required`.

## `interface`

> Accept a *query* as search text and return *search results* as matching
> records. A *cached result* may be returned when the query is unchanged.

```
(claim "f2" "SearchService" "provides" "query" "required" "true")
(claim "f2" "SearchService" "provides" "search results" "required" "true")
(claim "f2" "SearchService" "provides" "cached result" "permitted" "true")
```

Three claims from one Facet, because it offers three distinct promises. The
cache is offered, not promised, so it is `permitted`. Note what is *not* here:
nothing says the panel depends on the service. That would be a deduction.

## `state`

> The *active request* is the only one whose results may be published.

```
(claim "f3" "SearchPanel" "owns" "active request" "required" "true")
(property "f3" "active request" "exclusive" "true")
```

An ownership claim plus the property that makes it exclusive. The exclusivity is
a property of the state, so it travels on a `property` row.

> The *draft lock* is held by one editor, and the panel is the only one that may
> set or clear it.

```
(claim "f10" "SearchPanel" "owns" "draft lock" "required" "true")
(property "f10" "draft lock" "exclusive" "true")
```

"Only one that may set or clear it" is the same exclusivity as "the only one
whose results may be published". Without the `property` row, two components
that both claim to own the state do not conflict and the overlap goes
unreported. Write the `property` row whenever a Facet says it alone may change
the state.

## A Tag the component already has

> The panel keeps each cached result on screen until the query changes.

```
(claim "f9" "SearchPanel" "uses" "cached result" "required" "true")
```

`cached result` is written bare because the interface Facet above already
introduced it. A Tag that exists is named exactly, with no asterisks, and the
claim is grounded. Asterisks would define it a second time.

## `logic`

> Publishing results requires a *completed search*. A *superseded publication*
> must not occur.

```
(claim "f4" "SearchPanel" "requires" "completed search" "required" "true")
(claim "f4" "SearchPanel" "provides" "superseded publication" "required" "false")
```

The second claim's `expected` is `false`: the Facet asserts the relation must
not hold. That is a prohibition, not an absence.

### `logic` that describes a flow

Logic prose that walks through a sequence of steps is returned as a graph
instead. The Facets of one Logic section are presented together; number the
steps across the whole section.

> **f5** — Consume the loaded *WorkspaceModel* through *RelationshipResolution*
> to obtain relationship data and diagnostics.
>
> **f6** — Derive the workspace glossary projection through
> *GlossaryInspection*, then construct the relationship graph through
> *GraphConstruction*.
>
> **f7** — Return one *ResolvedSigilWorkspace* containing resolution data,
> graph data, glossary data, and merged diagnostics.

```
(step "f5" "1")
(step "f6" "2")
(step "f6" "3")
(step "f7" "4")
(claim "f5" "step:1" "reads" "WorkspaceModel" "required" "true")
(claim "f5" "step:1" "invokes" "RelationshipResolution" "required" "true")
(claim "f6" "step:2" "invokes" "GlossaryInspection" "required" "true")
(claim "f6" "step:3" "invokes" "GraphConstruction" "required" "true")
(claim "f7" "step:4" "invokes" "ResolvedSigilWorkspace" "required" "true")
(claim "f5" "step:1" "to" "step:4" "required" "true")
(claim "f6" "step:2" "to" "step:4" "required" "true")
(claim "f6" "step:3" "to" "step:4" "required" "true")
(claim "f7" "step:4" "to" "graph" "required" "true")
```

Read the edges carefully, because they are what the check rests on.

**f6 sequences its two steps with "then", and that is not an edge.** The
paragraph says construct the graph *after* deriving the glossary. It does not
say the graph construction uses the glossary projection. So there is no edge
from step 2 to step 3 — and it would be wrong to add one, because it would make
step 2 reach the end through step 3 no matter what actually consumes the
glossary.

The edges that do exist come from **f7**, which names what the result contains:
resolution data, graph data and glossary data. Each of those is something a
step produced and this step consumes, so each is an edge.

**Step 4 ends the flow**, and its edge to `graph` is what says so. Returning a
result does not end a flow by itself; nothing is inferred from what a step does.

## `constraints`

> Search must answer within 200 milliseconds. The panel may not reach the
> *record store* directly.

```
(measure "f5" "SearchService" "latencyBudgetMs" "200")
(claim "f5" "SearchPanel" "uses" "record store" "required" "false")
```

A bound becomes a measure. A prohibition becomes a claim whose `expected` is
`false`. Both are `required`, because Constraints binds.

## `decisions`

> We considered a *result cache* in the panel and rejected it, because two
> caches would disagree. We assume the *record store* stays reachable.

```
(claim "f6" "SearchPanel" "owns" "result cache" "permitted" "false")
(claim "f6" "SearchService" "dependsOn" "record store" "assumed" "true")
```

The rejected alternative is recorded, not promoted: it is reported and passed to
the judge, but a Decisions Facet raises no obligation and satisfies none. The
assumption carries modality `assumed`.

If a Decisions Facet is pure rationale with nothing to record — an explanation of
why something was done, naming no entity relationship — return a reading row
instead:

```
(reading "f6" "no-commitment")
```

### A flow whose checks can refuse

> Checking a query takes two steps. Step one reads the *query length* and
> rejects an empty query. Step two returns the *search results*.

```
(step "f11" "1")
(step "f11" "2")
(claim "f11" "step:1" "reads" "query length" "required" "true")
(claim "f11" "step:2" "writes" "search results" "required" "true")
(claim "f11" "step:1" "to" "step:2" "required" "true")
(claim "f11" "step:1" "to" "graph" "required" "true")
(claim "f11" "step:2" "to" "graph" "required" "true")
```

Step one has two edges: to step two when the query passes, and to `graph` when
it rejects. The rejection is that branch's end. Without the second edge, a
reader of the rows sees a check that feeds nothing and ends nowhere.

### A step that never ends

> Answering a query takes two steps. Step one reads the *query*, and step two
> returns the *search results*. Refreshing the *result digest* takes one more
> step: step three compares the result digest with the one kept from the last
> refresh.

```
(step "f13" "1")
(step "f13" "2")
(step "f13" "3")
(claim "f13" "step:1" "reads" "query" "required" "true")
(claim "f13" "step:2" "writes" "search results" "required" "true")
(claim "f13" "step:3" "reads" "result digest" "required" "true")
(claim "f13" "step:1" "to" "step:2" "required" "true")
(claim "f13" "step:2" "to" "graph" "required" "true")
```

Step two returns, so it ends the flow. Step three is the last step of its
sentence, but the prose never says it returns or finishes, and nothing uses what
it compares. It gets no edge. The tool reports it as an unreached step. That is
a real gap in the design, and an edge to `graph` would hide it.

### A scoped exception

> The panel provides the *history view* of a closed search, with no *search
> results* in it.

```
(claim "f12" "SearchPanel" "provides" "history view" "required" "true")
```

One claim. The phrase "with no search results in it" holds only inside the
history view. Writing `SearchPanel provides search results` as `false` would
say the panel never provides results, and would contradict every Facet that
promises them.

## `cases`

> Given an empty query, the service provides an *empty result* and reports no
> error.

```
(claim "f7" "SearchService" "provides" "empty result" "permitted" "true")
```

One example, one permitted outcome. An example does not quantify over all
inputs, so this is `permitted` rather than `required`. It does not become a
general promise that every query returns something.

## A Facet whose intent you cannot resolve

> Results are ordered appropriately.

```
(reading "f8" "unresolved")
```

"Appropriately" leaves a consequential choice open and names no relationship.
Do not invent a ranking rule. Say it is unresolved and let the judge ask.
