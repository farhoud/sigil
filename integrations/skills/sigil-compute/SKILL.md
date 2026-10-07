---
name: sigil-compute
description: Run the claims loop on an existing Sigil 0.9 design and hand back the ingest state — Coherent, Loose, or Disjoint — with the computed findings report, or, for the whole design, read every unread source and hand back the linked check's state, which may also be Incomplete. Use only when the request names claims, `sigil-claims`, computed findings or checks, or this skill; a generic request to review or evaluate a design stays on `sigil-evaluate`.
---

# Computed design evaluation

Own the `sigil-claims` loop end to end: prepare the interpretation request,
delegate the reading to one fresh child, ingest the returned rows, and hand
back the ingest state plus the findings report. A generic "review this design"
request does not load this skill: advisory evaluation by `sigil-evaluate` keeps
that job, and `sigil-write` still delegates its review there.

Read the [orchestration contract](references/computed-evaluation.md) before
running the loop. It owns source selection, the private store, the
child handoff, recognizing a completed ingest, the failure path, and the
result handoff.

The full-design action is an alternative to that one-source loop. When the
request names the whole design, it reads every source that still has unread
units, one fresh child per source, then runs the linked `sigil-claims check`
and hands back its state (Coherent, Loose, Disjoint, or Incomplete) and report.
It also copies the readings it added back to the workspace store, which the
one-source loop never does. The contract's full-design section owns the steps.

The loop's interpretation is one fresh child with no inherited conversation,
loaded with the installed [understanding](../sigil-understand/SKILL.md) and
[egglog](../sigil-egglog/SKILL.md) entrypoints. `sigil-understand` is the
design-language authority, `sigil-egglog` is dialect background, and the
prepared request's guidance is binding for row shapes and accepted names. The
claims binary never reads skills and never launches a model; the child only
interprets, and this skill runs the tool.

The input is an existing Sigil 0.9 design that the tool can prepare — never a
0.7 contract, never a greenfield design to be written first. This skill does
not author, revise, or delete design files. When any step cannot finish, stop
and name the break: never name Coherent, Loose, or Disjoint without a report
that a completed ingest wrote.
