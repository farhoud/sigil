# Prose the claims check can read

`sigil-claims` checks a design in three stages:

1. A model reads each Facet and returns short data rows, such as
   "Booking requires recurring booking series".
2. The tool keeps a row only if every name in it is something that Facet can
   talk about.
3. Fixed rules look for contradictions, ownership conflicts, missing providers,
   and broken flows in the rows that were kept.

The rules only see the rows. A promise the model cannot turn into a clean row
is never checked. Write each Facet so the right row is the obvious reading.
These rules keep the prose short. They ask for exact words, not more words.

## Every Facet names at least one Tag

Every Facet must reference or define at least one Tag in its own prose. This
applies to every contract role, including Goal, Decisions, and Cases. It also
applies to the introduction of an Embedded Facet.

What counts:

- A bare reference to a local or imported Tag, spelled exactly.
- An inline definition such as `*recurring booking series*`.

What does not count:

- A group heading. The Facets under it record the group, but the claims
  check does not treat the heading as a name in the Facet.
- A Tag name that appears only in a fenced payload or inside a link.
- A mention of a Component only.

Why: a row may name only the Facet's own Component, a Component the source
imports from, or a Tag that appears in that Facet's prose. A Facet with no
Tag can only produce rows about whole Components. Those rows are too coarse to
find the real problem, or the tool rejects them as ungrounded.

`sigil check` and the editor report each such Facet as a `SIGIL_UNTAGGED_FACET`
warning.
Treat that warning as a failure in the authored scope.

If a Facet has no concept worth a Tag, it is usually not a separate promise.
Merge it into the Facet it supports, or cut it.

## Name the exact thing

1. **Name the Tag, not the Component, when the promise is about the concept.**
   Say "Booking requires the recurring booking series", not "Booking relies on
   Scheduling and Recurrence". In the Slotted run, prose that was vague here
   produced a contradiction about the wrong object.
2. **Use one spelling for one thing.** When two Facets talk about the same
   concept, both must use the same Tag. A synonym is a different name and the
   rules will not connect them.
3. **Never give a Tag the same name as a Component.** The tool refuses a name
   that matches two things. `UserProfile` as both a Component and a Tag
   stopped the whole Auth check.

## Say the relation plainly

The rules act on a small set of relations. Use the plain verb that matches the
promise, so the model does not have to guess.

| If you mean | Write | What the check can then do |
| --- | --- | --- |
| This Component keeps the data | "X owns T" | Find two owners of an exclusive Tag. |
| Only one Component may own it | "X exclusively owns T" | Needed for the ownership conflict check. |
| This Component offers it | "X provides T" | Satisfy someone's requirement. |
| This Component needs it | "X requires T" | Report it if nothing provides T. |
| This Component calls another | "X depends on Y" | Connect a requirement to Y's provision. |
| This is forbidden | "X must not ... T" | Find a contradiction with a positive promise. |

- **`owns` and `provides` are different.** Do not use one for the other.
- **An import is not a dependency.** If X really uses Y, say "X depends on Y".
  An import only makes Y's Tags nameable.
- **Put a requirement's provider one step away.** The check looks for T in the
  Component itself, or in a Component it directly depends on. If the provider
  is further away, say "X depends on Y" for that provider too.
- **Match modality words to intent.** "Must" is a requirement. "May" is a
  permission and creates no obligation. "Assumes" records something the design
  relies on but does not promise.

## Put each promise in the right role

- **Decisions do not commit.** A promise written only in Decisions is never
  checked. State the rule in Constraints or Interface, and keep only the reason
  in Decisions.
- **A Case is one example.** It does not become a general rule. If a behavior
  must always hold, state it in Interface, Logic, or Constraints.
- **A negative rule belongs in Constraints.** Use the same Tag the positive
  promise uses, so the two can be compared.

## Write Logic as a flow with clear ends

The check turns Logic into numbered steps and edges between them.

1. **One step per sentence, in order.** Start each step with its action.
2. **Say what each step reads and writes,** using Tags.
3. **Say who uses each step's result.** "then" states an order, not a use.
   Write "step three sends the expanded dates to ...", or "the flow returns the
   series".
4. **Say where the flow ends.** Every branch ends by returning a result or by
   stopping. An ending is never assumed.
5. **Name the constraint a step must respect.** If a Constraint requires T and
   a step touches T, the step should say it checks that constraint.

An output that no step or interface uses is a design gap. Fix it in the design
itself: return the result from the Interface, use it in a later step, or remove
it. The claims check does not detect this gap on its own.

## Before capture

Check the authored scope against this list:

- Every Facet names at least one Tag in its own prose.
- No Tag shares a name with a Component.
- The same concept uses the same Tag everywhere.
- Every requirement has a provider one dependency away, or an open question
  about who provides it.
- Every Logic step's result has a stated user or a stated end.

Fix a failure by editing the prose. Do not add Facets or Tags only to satisfy
the list. If the fix needs a policy the user has not decided, record it as an
open question.
