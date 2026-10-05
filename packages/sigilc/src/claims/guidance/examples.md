# One worked Facet per role

## goal

> [f1] Provide *record search*: find records matching a supplied query.

```
(claim "f1" "SearchService" "provides" "record search" "required" "true")
```

## interface

> [f2] Return *search results*. A *cached result* may be returned.

```
(claim "f2" "SearchService" "provides" "search results" "required" "true")
(claim "f2" "SearchService" "provides" "cached result" "permitted" "true")
```

## state

> [f3] The *active request* is the only one whose results may be published.

```
(claim "f3" "SearchPanel" "owns" "active request" "required" "true")
(property "f3" "active request" "exclusive" "true")
```

Write the `exclusive` row whenever a Facet says only it may change the state.

## logic

> [f4] Step one reads the query length and rejects an over-long query.
> [f5] Step two reads the *record store*, then step three updates the
> *result digest*.
> [f6] Step four returns the search results found by step two.

```
(step "f4" "1")
(step "f5" "2")
(step "f5" "3")
(step "f6" "4")
(claim "f4" "step:1" "reads" "query length" "required" "true")
(guard "f4" "1" "constraint" "f7")
(claim "f5" "step:2" "reads" "record store" "required" "true")
(claim "f5" "step:3" "writes" "result digest" "required" "true")
(claim "f6" "step:4" "writes" "search results" "required" "true")
(claim "f4" "step:1" "to" "step:2" "required" "true")
(claim "f4" "step:1" "to" "graph" "required" "true")
(claim "f5" "step:2" "to" "step:4" "required" "true")
(claim "f6" "step:4" "to" "graph" "required" "true")
```

Step one rejects, so it ends a branch; passing goes on to step two. "Then" is
order, not use: step four consumes step two, and step three feeds and ends
nothing, so it gets no edge. The guard names f7, the Constraints Facet step one
checks; f7 introduces query length, so f4 writes it bare.

## constraints

> [f7] Search must answer within 200 milliseconds and stay within the *query
> length* limit. The panel may not reach the record store directly.

```
(measure "f7" "SearchService" "latencyBudgetMs" "200")
(claim "f7" "SearchService" "requires" "query length" "required" "true")
(claim "f7" "SearchPanel" "uses" "record store" "required" "false")
```

## decisions

> [f8] We rejected a *result cache* in the panel. We assume the record store stays reachable.

```
(claim "f8" "SearchPanel" "owns" "result cache" "permitted" "false")
(claim "f8" "SearchService" "dependsOn" "record store" "assumed" "true")
```

## cases

> [f9] Given an empty query, the service provides an *empty result*.

```
(claim "f9" "SearchService" "provides" "empty result" "permitted" "true")
```
