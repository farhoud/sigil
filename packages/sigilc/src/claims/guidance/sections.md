# Contract roles, and what to assert from each

Every Facet you read belongs to exactly one of seven contract roles. You are not
told the role in the row you complete, and you must not restate it: the tool
fills that column from the design export, which is the only thing that knows it.
What the role changes is *what kind of claim the Facet can support*.

| Role | Read it as |
| --- | --- |
| `goal` | Purpose, responsibility, and intended outcomes. |
| `interface` | Offered interactions and observable promises. |
| `state` | Meaningful data, modes, and conditions. |
| `logic` | Behavior, flows, guards, and transitions. |
| `constraints` | Binding invariants, prohibitions, bounds, and architecture choices. |
| `decisions` | Rationale, assumptions, alternatives, trade-offs, and revisit conditions. |
| `cases` | Starting situations, actions, and expected observations in examples or families. |

These readings are the language's own, not this tool's. `goal` and `interface`
are required of every component; the other five are optional and may be empty.

## Assert only what the Facet authored

This is the rule the whole pipeline rests on. Three kinds of statement are easy
to confuse, and only the first is yours to assert.

**An authored commitment** is something the Facet says. Assert it. If the Facet
says a component provides a capability, return that claim.

**A supported deduction** is something that follows from what the Facet says.
Do not assert it. The laws derive consequences themselves — reachability through
dependencies, capability through delegation, a contradiction between two
commitments. Asserting a deduction as though it were authored inflates the
design with facts nobody wrote, and the tool cannot tell them apart afterwards.

**Unresolved intent** is a consequential choice the Facet leaves open, or
material you cannot see. Do not guess it and do not assert it as fact. Return a
`reading` row with outcome `unresolved`.

A Facet you read and drew no commitment from is not a failure, and it is not
silence either. Return a `reading` row with outcome `no-commitment`. That is how
the tool tells a Facet you considered from one you never looked at — a Facet
that yields nothing at all is reported as a gap in the interpretation, and
rationale-only prose in a `decisions` Facet is a normal, correct `no-commitment`.

## Modality

Every claim carries one of three modalities, and getting it wrong changes what
the tool computes.

- `required` — the Facet states this must hold. Only a required claim raises an
  obligation that something else has to satisfy.
- `permitted` — the Facet allows it without demanding it. Raises no obligation.
- `assumed` — the Facet depends on it without promising it. Raises an
  assumption obligation rather than a capability one.

"Must return a result" is `required`. "May return a cached result" is
`permitted`. "Assumes the store is reachable" is `assumed`.

## Naming what a claim is about

A claim's subject and object must each be one of three things:

1. the Facet's own component;
2. a component its source imports from;
3. a Tag that appears in this exact Facet's own prose, spelled exactly as the
   Tag is named.

The third case covers two ways a Tag reaches the prose. A Tag the Facet
introduces is marked with asterisks: `*a name like this*`. A Tag that already
exists, whether the component defines it elsewhere or imports it, is written
bare, with no asterisks: `a name like this`. Both are grounded.

An asterisk defines a new Tag. Never put asterisks around a Tag that already
exists. Doing so declares a second definition and the design fails its check.

A claim about anything else is rejected as ungrounded, even though the row is
otherwise well-formed. That includes a Tag that appears only in a different
Facet's prose, a plural or differently cased form that does not match the
Tag's name, and a Tag owned by a source this one does not import. If a Facet's
prose does not name a Tag, do not invent a claim about it. Return a `reading`
row instead.

**Who does the requiring.** For `requires`, `provides`, `owns`, and `dependsOn`,
the subject is a component (or a step, for a flow). Never a Tag. A Tag cannot
provide anything, so `booking request requires open time` can never be
satisfied and reports an obligation that nothing could meet. When a Facet says
a *booking request* must lie inside open time, the requirement belongs to the
component that handles it: `Booking requires open time`.

**A scoped exception is not a global ban.** When a Facet says something is
absent only in one case, such as "the view of a closed search, with no search
results in it", assert the positive part and stop. Do not write the exception
as `expected` `false` about the whole component. The claim format cannot say
"only here", so a global `false` contradicts every Facet that promises the
thing in general. Write the positive claim and leave the exception unclaimed.

## What the role does to a claim

A `decisions` Facet's claims are retained and reported, and are passed to the
judge, but they raise no obligation and satisfy none. Rationale does not convert
a rejected alternative or an unaccepted proposal into a commitment. Return the
claims anyway — being able to see what a Decisions Facet argued is the point —
but do not promote a considered option into a promise.

A `cases` Facet describes examples. An example does not silently quantify over
all inputs; required and permitted outcomes differ. Prefer `permitted` unless
the Facet states the case as a general rule.
