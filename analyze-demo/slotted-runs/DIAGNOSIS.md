# What went wrong in the Slotted claims runs

This folder holds the records of the latest two passes on the Slotted export,
run under the corrected guidance (`r2/`).

- Each pass folder has one folder per source. Each has the child's rows
  (`artifact.txt`), the report, the context, and the prepared request.
- `analyze.py r2` prints the per-run numbers used below. Run it from this folder.

The design files were the same in both passes. Any difference comes from how
the interpreter children read the prose.

## 1. The numbers

"Commitment" means the child wrote a claim or a step for a facet. "No
commitment" means it wrote only a `reading` row.

| Pass | booking: facets with a commitment (of 64) | Booking state |
| --- | --- | --- |
| 1 | 51 | Disjoint |
| 2 | 45 | Disjoint |

## 2. Diagnosis: what went wrong, in order of impact

1. **The ownership conflict depends on one marker that children skip.** The
   law needs Booking's `owns` claim plus an `exclusive` property on the archived
   room. In r2 pass 1 the child wrote `authorityFor` and `owns`, but no
   `exclusive` property. Without it, two `owns` claims do not conflict. So the
   finding was missing. Pass 2 wrote the
   property and got the conflict. The sentence "Booking is the only one that
   may set or clear it" is the exclusivity signal. The guidance shows "the only
   one whose results may be published", and children do not always connect
   the two.

2. **Calendar's dead-end step is never a dead end.** In both passes the
   child gave step 8 (the compare step) an edge to `graph`. The child treats
   the last step of a flow as its end. The planted step is the last step of its
   own two-step paragraph, so it always looks finished. `unreached-step` only
   fires for a step with no path to an end, for example a side step in the
   middle of a flow that has another end.

3. **Validation steps look like dead ends, and only sometimes.** In
   `shared.sigil`, steps 1 and 2 ("check the grid", "reject a nonexistent
   local time") pass nothing to a later step. Both steps had no outgoing edge in
   both passes. So `unreached-step` fired each time.
   The same happened to Rooms step 2 (validate the timezone) in pass 1. In
   pass 2 the child treated the rejection as a branch that ends the flow.
   The prose is consistent. The children are not. This moves shared and rooms
   off Coherent. Availability and rooms also get `unguarded-flow` warnings,
   where a constraint names something that no step checks. Those come from the
   extra claims the new guidance lets children make.

4. **Some unmet-obligation findings are false alarms from a wrong subject.**
   Booking facet 6528 says a booking request must lie inside open time, use
   the clock, and so on. The child wrote `booking request requires open time`.
   The subject is a Tag. Only a component can provide things, so nothing can
   ever satisfy it. The same happened in calendar with `requestable slot`.
   The guidance does not say that the subject of `requires` must be a
   component.

5. **One unmet-obligation finding is real.** Slotted says it needs the
   signed-in user and domain errors. Identity and SharedKernel provide both,
   and the child wrote those provider claims. But the law only counts a
   provider if Slotted states `dependsOn` that component. Slotted's prose never
   says it depends on Identity or SharedKernel. It lists module dependencies
   and leaves those out. This appeared in every r2 slotted pass. It is a true
   gap in the design text.

6. **A scoped exception became a global ban.** Calendar facet 4322 says the
   calendar view of an archived room has "no requestable slot in it". The
   child wrote `Calendar provides requestable slot` as false. Facet 4435 says
   Calendar provides requestable slots. The two claims contradict, and
   Calendar was Disjoint in r2 pass 2. The claim format cannot say "only for
   archived rooms", so the scope was lost.

7. **A relation was misused.** Booking facet 5892 says only a confirmed booking
   blocks a new request. The child wrote `Booking excludes booking request`.
   Flow steps that write a booking request then broke that claim, giving two
   `step-excluded-action` findings in r2 pass 1.

8. **Children claim Tags the facet cannot see.** Slotted's r2 pass 1 had 8
   `ungrounded-claim` findings, for example about `room list`, `archived room`,
   and `decline cause`. Slotted does not import those Tags. The child read the
   words in Slotted's prose and named the provider's Tag. The tool refused the
   claim. The advisory review saw the same gap: Slotted uses the words without
   importing the Tags.

## 3. What each pass did

### Pass 1
Booking Disjoint from the contradiction only. The ownership conflict was
missing (diagnosis 1). Calendar Loose, with the display-name warning but no dead
end (diagnosis 2). Slotted had 8 ungrounded claims (diagnosis 8) and 2 unmet
obligations (diagnosis 5). Shared and rooms had dead-end validation steps
(diagnosis 3).

### Pass 2
Booking Disjoint with both problems. Calendar Disjoint from the scoped
negation (diagnosis 6). Slotted had 3 unmet obligations (diagnosis 5). Shared
Loose from dead-end steps (diagnosis 3).

## 4. What to change, by where the fix lives

**Guidance (interpretation rules)**
1. Say the subject of `requires` and `provides` must be a component, not a Tag.
2. Say a sentence like "the only one that may ..." must produce an `exclusive`
   property, and show that with an example that uses `may set or clear`.
3. Say a rejection or refusal branch ends a flow, and show it with an edge to
   `graph`.
4. Say a scoped exception ("with no X in it" for one case) should be a
   `reading`, not an unconditional `required false` claim.

**Design text (only if the demo should be more stable)**
1. Move the dead-end step to the middle of a flow that has its own end.
2. Add "Slotted depends on Identity and SharedKernel" if the gap is unintended.
3. Import the Tags Slotted names in plain words, or drop those words.

**Tool**
1. Consider a warning when a `requires` subject is a Tag.
2. Consider reporting a missing `exclusive` property when two components `own`
   the same Tag and one facet says "the only one".

None of these changes have been made.

## 5. Follow-up: r3, after the four guidance fixes

The four guidance changes in section 4 were made (commit "tighten
interpretation guidance after the Slotted gradient analysis"). The design files
did not change. `r3/` holds a fresh two-pass run under the new guidance
(fingerprint `a0ce1299…`). The "None of these changes have been made" line above
refers to the design-text and tool items only.

### Did each fix work?

| Fix | Result in r3 |
| --- | --- |
| A Tag is never the subject of `requires` / `provides` / `owns` / `dependsOn` | Worked. No run has such a claim. The false unmet-obligation alarms (`booking request requires open time`, `requestable slot requires open time`) are gone. |
| "Only one that may set or clear it" writes an `exclusive` property | Worked. Booking was Disjoint in both passes with the ownership conflict each time (2 findings). r2 pass 1 had none. |
| A rejection ends a flow branch | Worked. No step in any run lacked an end, so there is no `unreached-step` anywhere. shared and rooms no longer show it. |
| A scoped exception is not a global `false` | Worked for calendar. Calendar is Loose in both passes. The unintended Disjoint from r2 pass 2 did not come back. |

### What r3 still shows

1. **Calendar's dead-end step is still invisible.** It is the last step of its
   own paragraph, so every child gives it an edge to `graph`. Fix 3 made this
   more reliable. The planted problem cannot fire until the step sits in the
   middle of a flow that has another end. This is a design-text change.
2. **`unguarded-flow` went up.** It is 4, 1, 5 in rooms, shared, availability
   pass 1 and up to 8 in availability pass 2. Children now write more claims,
   including step-level claims, and a constraint that names the room lock or the
   clock with no step guarding it is reported. These warnings do not gate. They
   are real observations about the prose, not interpreter mistakes.
3. **Slotted still has a real gap and some ungrounded claims.** Every slotted run
   reports the unmet obligation on `domain error` or `signed-in user`, because
   the prose never says Slotted depends on SharedKernel or Identity.
   Slotted pass 2 also has 5 ungrounded claims about `room list`,
   `archived room`, `decline cause`, and `Availability`. Slotted does not import
   those Tags. The advisory review flagged the same gap.
4. **Children still misnumber steps now and then.** The first booking pass-1
   child gave two Rooms steps the same ordinal (`rooms.sigil:705` and
   `rooms.sigil:968` both as step 1). The tool refused the artifact. A second
   fresh child passed. The refused rows are in `r3/refused-pass1-booking/`.
   The guidance already says to number across the whole section. A worked
   example of a two-paragraph section would help.
5. **Booking pass 1 still has 19 `unguarded-flow` warnings,** and one
   `uninterpreted-section`. That child made many step-level claims. The noise
   is from breadth, not wrongness.

### What to change next

1. **Design text** (voids the current results): move calendar's owner-digest step
   into the middle of a flow that has its own end; add "Slotted depends on
   Identity and SharedKernel"; import or drop the Tag words Slotted uses.
2. **Guidance:** add a worked example of a Logic section that spans two
   paragraphs, so ordinals run across both.
3. **Tool (optional):** consider not treating `unguarded-flow` as a warning for
   constraints that name a shared dependency a flow uses implicitly, or show
   these warnings separately from the planted-problem findings in the demo.

## 6. Follow-up: r5, after "an end is declared by the prose"

Two more guidance changes were made after section 5: a flow ends only where the
prose declares it (not because a step is last in its paragraph), and a step
that commits, saves, or completes the command counts as an end. The design files
did not change. `r5/` holds the run (fingerprint `fbe42d67…`). A calendar-only
trial in between (guidance commit before the "commits" line) showed
`unreached-step` firing for the digest steps in 2 of 2 passes, but also left
Booking's availability-edit and archive flows without an end, which the
"commits" line then fixed.

### Did each change work?

| Change | Result in r5 |
| --- | --- |
| A flow ends only where the prose declares it | Worked. Calendar's owner-digest steps raised `unreached-step` in both passes. It was invisible in every earlier gradient. |
| A commit is an end | Worked. Booking's availability-edit and archive flows are no longer flagged. Shared and rooms stayed free of `unreached-step`. |

### What r5 shows

1. **All four planted problems appeared in both passes**: booking Disjoint with
   the contradiction and the ownership conflict, calendar Loose with the
   display-name warning and the dead-end step.
2. **A new finding, later shown to be a false positive:** Booking's
   timezone-change and unarchive paragraph (booking.sigil:5002) says each "calls
   the mutation through the transactional entry of Rooms" and never says it
   returns or commits. Two `unreached-step` findings point at it in both Booking
   passes. The end is written in Rooms: the room lock "commits and returns the
   result" (rooms.sigil:26-29), and Booking runs every workflow under that lock.
   Booking's text just never repeated it, and flows cannot link across
   components. Section 7 covers the design change that followed.
3. **`unguarded-flow` is still the largest source of warnings** (up to 15 in
   booking). Children rarely write `guard` rows. Section 5's wording that these
   are "real observations about the prose" was too generous: for booking, most
   are missing guard rows from the child.
4. **Slotted is unchanged.** It still reports the unmet obligation on the domain
   error, and pass 1 had 6 ungrounded claims about Tags it uses in plain words
   without importing.
5. **Step numbering:** no refused artifacts this time. All 14 passed ingest.

### What to change next

1. **Design text** (voids the current results): say Slotted depends on Identity
   and SharedKernel; import or drop the Tag words Slotted uses; add "and returns"
   to booking.sigil:5002 if the open end is unintended.
2. **Guidance:** add a worked example of a `guard` row so children tie a step to
   the constraint it satisfies, and a worked example of a Logic section split
   over two paragraphs.

## 7. Follow-up: r6, after Booking says "and commits"

Section 6's finding about booking.sigil:5002 was a false positive, not a gap.
The room lock in Rooms commits (rooms.sigil:26-29), and Booking's interface says
every workflow runs "under one room lock". Booking's availability-edit and
archive workflows already said "commits", but the timezone and unarchive
sentences did not, so a reader of Booking alone saw an open end. Commit 076d36d
added "and commits" to both. Only booking.sigil changed. The guidance was the
same as r5. `r6/` holds the run.

### What changed

| Check | Result in r6 |
| --- | --- |
| Booking's timezone and unarchive steps | No longer flagged. Three of those steps now have ends in every pass. |
| Calendar's owner-digest steps | Still raise `unreached-step`, 2 per pass. |
| Booking contradiction and ownership conflict | Both appear in both passes. |
| Calendar display-name unmet obligation | Appears in both passes. |

### What r6 still shows

1. **One `unreached-step` remains in booking.** It points at the
   availability-edit paragraph (booking.sigil:4136), the step "leaves every
   confirmed booking Confirmed". That step does nothing, so a child leaves it
   without an edge. It is a fair finding about the prose: a step that has no
   effect.
2. **New noise: `step-excluded-action` (8 and 9 in booking).** The constraints
   "Booking must not accept a booking request from the room owner" (5 findings),
   "only a confirmed booking blocks a new booking request" (1 or 2), and a rule
   about the nonexistent local time (2) were written as prohibitions. The
   submit flow's check on the room owner or the booking request then trips them,
   although that check is where the refusal happens. The guidance says a scoped
   prohibition should be a reading. Children did not follow it consistently.
3. **`unguarded-flow` is higher in booking (26 and 29).** More claims, few guard
   rows. Same cause as section 6, item 3.
4. **Slotted is unchanged:** a real unmet obligation on the domain error and the
   signed-in user, plus two ungrounded claims in pass 2.

### Limits worth knowing

1. Three children (calendar pass 1 and 2, slotted pass 2) ran on a different model
   from the other eleven, after a rate limit interrupted them.
2. One child said it had read another run's rows. That artifact was set aside and
   a fresh child, told to read nothing outside its prepared files, replaced it.
   The read limits were instruction-only in every run, so earlier runs cannot be
   cleared the same way.
3. The advisory reviewer was rerun on the new bytes. Its findings are in the demo
   doc. Four are the planted problems. Six are not, and one of them, about the
   room lock's audience, is related to the same Rooms-owns-the-end pattern.

### What to change next

1. **Guidance:** add a worked example showing a prohibition on accepting a
   request as a reading, not an exclusion that the refusing step trips.
2. **Guidance:** add a `guard` row example so children tie a step to the
   constraint it satisfies.
3. **Design text** (voids the results): the six unplanted advisory findings,
   Slotted's dependency sentence, and the no-effect step in the availability edit.

## 8. Follow-up: r7, after the guard example and the refused-rule example

Two more guidance additions were made after section 7: a worked `guard` row,
and a rule that "must not accept X" is a reading, not an exclusion. A sentence in
the examples that said "returning a result does not end a flow" was also
reconciled with the newer "a return is declared as an end" rule. The design is
the same as r6. `r7/` holds the run (fingerprint `b100d025…`), with every child on
one model.

### Did each change work?

| Change | Result in r7 |
| --- | --- |
| A refusal rule is a reading | Worked. `step-excluded-action` in booking fell from 8 and 9 to 0. |
| A guard row ties a step to its constraint | Worked in part. `unguarded-flow` fell in every source that had it: rooms 3, 4 to 1, 2; availability 6, 8 to 2, 2; booking 26, 29 to 11, 14. It is still the largest source of warnings in booking. |
| Booking's timezone and unarchive end | Held. No `unreached-step` in booking. |
| All four planted problems | Appeared in both passes. |

### What r7 still shows

1. **Slotted is noisier.** Ungrounded claims rose from 0 and 2 to 4 and 5. Children
   name `room list`, `decline cause`, `archived room`, and the module Availability
   in Slotted's facets, and Slotted does not import them. Several children said
   they "assumed" Slotted imports Availability and Booking. The imports are in the
   request, so this is a reading error. A design fix is cheap: Slotted already
   uses these words in plain prose, so either import the Tags or drop the words.
2. **A real unmet obligation remains in slotted,** in both passes.
3. **Booking pass 1 has one `uninterpreted-section`** (the goal) and one ungrounded
   claim about `booking request` in the goal. Both are the child's misses, not
   design flaws.
4. **Three children broke the "no helper files" rule** and deleted what they
   wrote. None read another run, but the read rule was instruction-only. The one
   child in r6 that read another run's rows was caught only because it said so.

### What to change next

1. **Design text** (voids the current results): Slotted's dependency sentence
   (Identity and SharedKernel), the Tag words Slotted uses without importing, and
   the six unplanted advisory findings.
2. **Guidance:** a line that every component named in a claim must appear in the
   request's import list, with an example, to stop the "assumed import" misses.
3. **Tool (optional):** do not count a Tag the facet cannot see as an
   interpretation finding against the selected source when the same facet is in
   another source's closure only.
