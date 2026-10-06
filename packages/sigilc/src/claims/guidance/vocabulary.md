# The rows you may return

Return only S-expression rows. Every argument is a quoted string literal: no
rules, commands, schedules, nested expressions or arithmetic. One rule anywhere
and the whole artifact is refused, valid rows included.

Each row's `facet` is the handle of the brief line it came from, such as f12.

```
(claim "<facet>" "<subject>" "<relation>" "<object>" "<modality>" "<expected>")
(property "<facet>" "<subject>" "<property>" "<value>")
(measure "<facet>" "<subject>" "<property>" "<number>")
(reading "<facet>" "<outcome>")
(step "<facet>" "<ordinal>")
(guard "<facet>" "<step>" "<operand>" "<value>")
```

- `claim`: `subject` stands in `relation` to `object`. `modality` is `required`
  (must hold; raises an obligation), `permitted` (allowed, not demanded) or
  `assumed` (depended on, not promised). `expected` is `true`, or `false` when
  the relation must not hold.
- `property`: a boolean property; `value` is `true` or `false`.
- `measure`: a numeric property; `number` is a non-negative decimal. `risk`
  lies between 0 and 1.
- `reading`: `outcome` is `no-commitment` or `unresolved`, for a Facet that
  yields no other row.
- `step`: `ordinal` counts from `1` across the component's whole logic
  section, in prose order, never repeating.
- `guard`: `step` is the ordinal. `operand` is `state` (a declared Tag the step
  reads), `input` (a literal text value) or `constraint` (`value` is the handle
  of the Constraints Facet that authored it).

## Flows

A component's logic lines sit together in source order. Read them as one
section: a flow often spans several lines. Name a step `step:<ordinal>` and the
flow `graph`. What a step `reads`, `writes` or `invokes`, and its `to` edges,
are claims, always `required` and `true`.

- A `to` edge runs from a step to the later step or result that consumes what
  it produced. "Then" states order, not consumption: no edge.
- An edge to `graph` declares an end. Write one only where the prose ends the
  flow: the step returns, refuses, rejects, commits or saves. Each refusing
  branch is its own end. Being last, writing state or calling out is not an
  end. A flow with no edge to `graph` is refused.
- A step nothing consumes, whose prose declares no end, gets no edge. The tool
  reports it.
- Logic prose that is not a flow is an ordinary claim.

## Names

Relations: `owns`, `provides`, `requires`, `dependsOn`, `excludes`,
`delegates`, `routesThrough`, `persistsAt`, `authorityFor`, `trusts`,
`invokes`, `reads`, `writes`, `uses`, `hasContract`, `from`, `to`, `target`,
`initialState`, `transitionsTo`

Boolean properties: `required`, `exclusive`, `assumed`, `expected`

Numeric properties: `cost`, `latencyBudgetMs`, `latencyMs`, `risk`

Never supply a contract role, a Component or Tag declaration, a claim
identity, or a law. The tool owns all four.
