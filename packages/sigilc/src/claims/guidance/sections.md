# Contract roles

Each `### <role>` heading in the brief names the role of the lines under it.
Never write the role in a row.

| Role | Read it as |
| --- | --- |
| `goal` | Purpose, responsibility, and intended outcomes. |
| `interface` | Offered interactions and observable promises. |
| `state` | Meaningful data, modes, and conditions. |
| `logic` | Behavior, flows, guards, and transitions. |
| `constraints` | Binding invariants, prohibitions, bounds, and architecture choices. |
| `decisions` | Rationale, assumptions, alternatives, trade-offs, and revisit conditions. |
| `cases` | Starting situations, actions, and expected observations in examples or families. |

## Assert only what the Facet authored

- An authored commitment is what the Facet says. Assert it.
- A supported deduction follows from what it says. Do not assert it; the laws
  derive it.
- Unresolved intent is a consequential choice left open, or material you
  cannot see. Return a `reading` with `unresolved`.
- A Facet that commits to nothing returns a `reading` with `no-commitment`.
  Pure rationale in `decisions` is a normal `no-commitment`.

## Naming what a claim is about

A subject or object is one of: the Facet's own component (its `##` heading);
a component that the Imports list shows the Facet's source importing from; a
Tag written in that Facet's own line, spelled exactly. `*Asterisks*` introduce
a new Tag. An existing Tag is written bare; never add asterisks to it.

The Entities list spans the whole closure, and being listed grounds nothing.
A Tag found only in another Facet's line, a changed plural or case, or a
component the source does not import is refused as ungrounded: return a
`reading` instead. An entity listed with a backticked id has a shared label;
write the id.

For `requires`, `provides`, `owns` and `dependsOn` the subject is a component
or a step, never a Tag.

An exception scoped to one case ("a closed search, with no results") is not a
global ban: claim only the positive part. A rule about what is refused
("must not accept X") is not an exclusion: return a `reading`.

## What the role does

`decisions` claims are reported but raise and satisfy no obligation; never
promote a rejected option. `cases` are examples: use `permitted` unless the
Facet states a general rule.
