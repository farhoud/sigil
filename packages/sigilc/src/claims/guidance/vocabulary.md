# The rows you may return

Return a plain list of S-expression rows and nothing else. No rules, no
commands, no schedules, no nested expressions, no arithmetic — every argument is
a quoted string literal. One rule declaration anywhere in the artifact and the
whole thing is refused, including the valid rows beside it.

Four row shapes exist. Each begins with the identity of the Facet it came from,
which you copy from the pre-filled row you were given.

## `claim` — six columns

```
(claim "<facet>" "<subject>" "<relation>" "<object>" "<modality>" "<expected>")
```

| Column | Meaning |
| --- | --- |
| `facet` | The Facet this claim was read from. Copy it; never invent one. |
| `subject` | The entity the claim is about. |
| `relation` | One of the relation names below. |
| `object` | The entity the subject stands in that relation to. |
| `modality` | `required`, `permitted`, or `assumed`. |
| `expected` | `true` if the Facet asserts the relation holds, `false` if it asserts it must not. |

## `property` — four columns

```
(property "<facet>" "<subject>" "<property>" "<value>")
```

For the boolean properties below. `value` is `true` or `false`.

## `measure` — four columns

```
(measure "<facet>" "<subject>" "<property>" "<number>")
```

For the numeric properties below. `number` is a finite, non-negative decimal
written as a string. `risk` is between zero and one.

## `reading` — two columns

```
(reading "<facet>" "<outcome>")
```

`outcome` is `no-commitment` when you read the Facet and it authored nothing to
assert, or `unresolved` when a consequential choice is left open or the material
you would need is unavailable. Return one for every Facet that yields no claim.

## `step` — two columns

```
(step "<facet>" "<ordinal>")
```

Declares one step of a flow. `ordinal` is the step's position across the whole
Logic section, counting from `1`, in the order the prose describes the steps —
not its position within one paragraph. Two steps in a section never share an
ordinal.

The ordinal is how every other row refers to this step. You cannot name a step
any other way: its identity is minted after your answer is read, so it does not
exist yet when you write.

## `guard` — four columns

```
(guard "<facet>" "<step ordinal>" "<operand>" "<value>")
```

`operand` is one of `state`, `input` or `constraint`, and `value` is what the
guard compares against:

- `state` — a Tag the design declares, which the step reads.
- `input` — a literal value, written as text. It is never resolved as an entity,
  so an argument name that the design never declares is fine here.
- `constraint` — the **Facet** that authored the constraint, not the claim.
  Claim identities do not exist yet when you write.

## What a step does is an ordinary claim

A step is an entity, so everything about it is a `claim`, not a row of its own:

```
(claim "<facet>" "step:2" "reads" "<tag>" "required" "true")
(claim "<facet>" "step:2" "writes" "<tag>" "required" "true")
(claim "<facet>" "step:2" "invokes" "<tag>" "required" "true")
(claim "<facet>" "step:2" "to" "step:3" "required" "true")
(claim "<facet>" "step:5" "to" "graph" "required" "true")
```

Write `step:<ordinal>` to name a step and `graph` to name the section's flow as
a whole. A claim naming either is always `required` and `true`: a step either
reads a state or it does not, and there is no permitted or assumed about it.

An edge — the `to` relation — runs from a step to whatever the prose says
consumes what that step produced: a later step, or the flow's result. What a
step reads, writes and calls are claims about the step, not edge targets.

**An edge to `graph` is what declares an end of the flow.** A flow with no such
edge is refused. A branching flow declares one end per branch, so more than one
edge to `graph` is normal.

**A rejection is an end.** A step that refuses the request, returns an error, or
stops because a check failed ends that branch of the flow, even when no later
step consumes its result. Give it an edge to `graph`. A check that only gates a
later step, such as "step one checks the grid, step two rejects a bad time", is
not a dead end: each refusal declares its own end, and the passing path goes on
to the next step.

**An end is declared by the prose, never by position.** Give a step an edge to
`graph` only when the prose says the flow ends there: the step returns a result,
refuses, or the prose says the flow is finished. A step that commits, saves,
or completes the command is an end, the same as a return: "step four commits"
finishes that command. Being the last step of a paragraph is not an end. Writing
state or calling outward is not an end either, unless the prose says that is
where the flow stops. A step that only compares, reads, or checks, and says
nothing about returning, refusing, or committing, is not an end.

**A dead end is reported, not repaired.** A step whose result no later step uses,
and whose prose declares no end, gets no outgoing edge at all. Do not add an edge
to `graph` to close it. The tool reports that step as unreached, and finding it
is the point.

A paragraph saying "derive X, then construct Y" states an order, not a
consumption: unless the prose says Y uses what X produced, there is no edge from
X to Y.

## Logic sections are presented whole

Every other contract role is presented one Facet at a time. Logic is not.

The request's `flows` list names each component's Logic section and lists its
Facet identities **in source order**. Each of those Facets still has its own row
in `rows`, with its own identity and its own prose — the grouping adds order and
membership and takes nothing away.

Read a section's Facets together. A Facet is a paragraph, and flow-shaped prose
routinely runs across several of them: one real design states its first step in
one paragraph, its middle two in a second, and its closing return in a third.
Reading any one of those alone, you cannot see where the flow goes.

A Logic section may also mix flow prose with prose that is not flow at all — a
paragraph stating which component owns which result shape is an ordinary claim,
not a step. Returning no step for such a Facet is correct, and does not make it
uninterpreted.

## Relation names

A claim's relation is one of these, and nothing else:

`owns`, `provides`, `requires`, `dependsOn`, `excludes`, `delegates`,
`routesThrough`, `persistsAt`, `authorityFor`, `trusts`, `invokes`, `reads`,
`writes`, `uses`, `hasContract`, `from`, `to`, `target`, `initialState`,
`transitionsTo`

## Boolean properties

`required`, `exclusive`, `assumed`, `expected`

## Numeric properties

`cost`, `latencyBudgetMs`, `latencyMs`, `risk`

## What you never supply

**A section.** No row carries the contract role. The tool fills it from the
export, because only the export knows it, and asking you to restate it would
create drift the column exists to catch.

**An identity.** The tool mints every claim identity. Do not declare a Component
or a Tag — the frontend reserves those — and do not name an entity outside the
design's resolved import closure.

**A law.** The rules that derive contradictions, ownership conflicts and unmet
obligations are compiled into the tool. You supply what the design says; the
tool decides what follows from it.
