# Slotted computed-evaluation demo

Slotted is a room-booking design. People own rooms and rent other people's
rooms, and the owner approves each request. This demo runs Sigil's computed
claims loop on it and shows what the loop reports.

The design is seven plain-prose files. Four deliberate design mistakes are
built into it. They are intentional demo content, so do not "fix" them. The
expected results below are targets, not guarantees. The loop uses a model to
read the prose, so fresh runs give different answers.

## The seven files

| Source | What it owns | Imports from |
| --- | --- | --- |
| `slotted.sigil` | The app: module list, dependency rules, technology stack | Identity, Rooms, Booking, SharedKernel |
| `identity.sigil` | User accounts, sessions, the signed-in user, `requireUser` | — |
| `rooms.sigil` | Rooms, room owners, room timezone, archiving, the room lock | Identity |
| `shared.sigil` | The kernel: clock, 30-minute grid, time conversion, domain errors | — |
| `availability.sigil` | Weekly windows, blackouts, open time | Identity, Rooms, SharedKernel |
| `booking.sigil` | Booking requests, their lifecycle, the no-overlap rule, owner workflows | Identity, Rooms, Availability, SharedKernel |
| `calendar.sigil` | The room calendar, with masking by viewer | Rooms, Availability, Booking, SharedKernel |

SharedKernel is a kernel, not a module. Any module may use it without a
dependency edge. Every facet in these files names at least one Tag. Each Tag
has one owning component, and other components reuse it through an import.

## The four deliberate problems

| Source | What the prose does | Intended finding | A remedy |
| --- | --- | --- | --- |
| `booking.sigil` | The interface says Booking provides a renter a *range change* of their own pending request. A constraint says Booking must not provide a range change of a pending request. | Contradiction | Decide whether a pending range may change. Then make the interface and the constraint agree. |
| `booking.sigil` and `rooms.sigil` | Booking says it owns the archived room mark and is the only one that may set or clear it. Rooms says Rooms owns the archived room mark. | Ownership conflict | Keep the mark in Rooms. Reword Booking so its workflows only call Rooms' archive and unarchive mutations. |
| `calendar.sigil` | A constraint requires the *renter display name* of each renter from Identity. Identity has no display name. | Unmet obligation | Give Identity a display name and an interface, or return the label from Booking, or use the email. |
| `calendar.sigil` | A separate logic step compares an *owner digest* with the previous one. It writes nothing and returns nothing. | Flow warning (`unreached-step`) | Delete the step, or say what consumes its result. |

For the ownership conflict, the evidence is two sentences: Booking's "owns the
archived room mark, and Booking is the only one that may set or clear it", and
Rooms' "Rooms owns the archived room mark".

The target gradient is:

- `slotted`, `identity`, `rooms`, `shared`, and `availability`: Coherent, exit 0.
- `calendar`: Loose, exit 0, with the unmet-obligation and unreached-step warnings.
- `booking`: Disjoint, exit 1, with the contradiction and ownership-conflict findings.

## Run the claims loop

`sigil-claims` never launches a model. The host captures an export, prepares
one exact source, gives the prepared request to one fresh interpretation child,
captures the child's rows, and ingests those exact bytes. Keep run files and
the private store outside `examples/slotted`. Use a new empty private root,
preparation directory, and fresh child for every source in every pass. If the
workspace has a `.sigil/claims/interpretations` folder, copy it into the private
root first. This workspace has none.

Build the binaries if they are missing, then prepare one source. Run this from
the repository root:

```sh
deno task build:cli
deno task build:sigilc

RUN="$(mktemp -d "${TMPDIR:-/tmp}/slotted-booking.XXXXXX")"
mkdir -p "$RUN/private-root"

build/sigil export design examples/slotted --root examples/slotted --format json \
  > "$RUN/frontend.json"

packages/sigilc/target/debug/sigil-claims prepare \
  --frontend "$RUN/frontend.json" \
  --source booking.sigil \
  --out "$RUN/prepared" \
  --root "$RUN/private-root"
```

Take the source name from the export's `sources[].path`. The seven values are
`slotted.sigil`, `identity.sigil`, `rooms.sigil`, `shared.sigil`,
`availability.sigil`, `calendar.sigil`, and `booking.sigil`.

Start a fresh child with no earlier conversation. Give it `request.json`,
`binding.json`, every prepared guidance file, the installed `sigil-understand`
and `sigil-egglog` skills, and one file to write, such as `$RUN/child-result.egg`.
The child returns only data rows. It does not run `sigil-claims` and does not
edit the design. Then ingest the exact bytes:

```sh
packages/sigilc/target/debug/sigil-claims ingest \
  --frontend "$RUN/frontend.json" \
  --binding "$RUN/prepared/binding.json" \
  --claims "$RUN/child-result.egg" \
  --root "$RUN/private-root"
```

Exit `0` means Coherent or Loose. Exit `1` means Disjoint, but only when the
ingest also prints a matching structured result and report. A bare exit code is
not a state.

A result counts only when all of these hold:

1. The report's source, state, and version match the ingest result.
2. The report's export digest, guidance fingerprint, and vocabulary generation
   match `binding.json`.
3. The report's paths lie under that run's private root.

## Two full runs against one export

Both gradients used one export and separate empty private roots. Every source
got a fresh child in each pass. The export has 7 sources, 16 imports, and 534
resolved references.

- Semantic export digest: `31f45784ffc9fa39bd218d9d784e2a1d2f2ba0b7b312a1e15ed56958ec21ec72`
- Raw export SHA-256: `d84767695be82c0899ed17b7121f0a1518f8d297dee4201f3f6549f7fdf1b00a`
- Source-byte manifest SHA-256: `dd772d6378905e06b1d144d219abcf3494cb06315043019456e97649c4f8620d`
- Guidance fingerprint: `fbe42d67b5ab0fc7448e745a0279d5d8b4831df911d7ac71912e13781bbc54f7`

The seven source files matched the manifest before both passes. Every prepare
reused zero units. All 14 counted results passed the identity checks above. I
did not recompute the per-artifact BLAKE3 digests.

Limits of this run:

1. The host limits were instruction-only. Each child was told to read only its
   prepared files and write only its own artifact. No operating system sandbox
   was enforced.
2. Eleven children ran on one model and three (calendar pass 1 and 2, slotted
   pass 2) on another, because a rate limit interrupted them and the model was
   changed before the rerun. Earlier gradients ran on the second model.
3. Four artifacts were set aside and replaced by fresh children: three were cut
   off by the rate limit, and one child said it had read another run's rows. The
   replacement child was told not to read other run folders.
4. One child created a temporary helper file and deleted it. It did not read
   another run.

| Source | Target | Pass 1 | Pass 2 | Facets presented |
| --- | --- | --- | --- | ---: |
| `slotted.sigil` | Coherent / 0 | Loose / 0, 4 unmet-obligation | Loose / 0, 2 unmet-obligation, 2 ungrounded-claim | 168 |
| `identity.sigil` | Coherent / 0 | Coherent / 0, none | Coherent / 0, none | 16 |
| `rooms.sigil` | Coherent / 0 | Loose / 0, 3 unguarded-flow | Loose / 0, 4 unguarded-flow | 40 |
| `shared.sigil` | Coherent / 0 | Loose / 0, 1 unguarded-flow | Loose / 0, 1 unguarded-flow | 18 |
| `availability.sigil` | Coherent / 0 | Loose / 0, 6 unguarded-flow | Loose / 0, 8 unguarded-flow | 81 |
| `calendar.sigil` | Loose / 0, unmet-obligation and unreached-step | Loose / 0, 1 unmet-obligation, 2 unreached-step, 2 unguarded-flow | Loose / 0, 1 unmet-obligation, 1 ungrounded-claim, 2 unreached-step, 2 unguarded-flow | 170 |
| `booking.sigil` | Disjoint / 1, contradiction and ownership conflict | Disjoint / 1, 3 contradiction, 2 ownership-conflict, 1 unmet-obligation, 9 step-excluded-action, 26 unguarded-flow, 1 unreached-step | Disjoint / 1, 3 contradiction, 2 ownership-conflict, 2 unmet-obligation, 8 step-excluded-action, 29 unguarded-flow, 1 unreached-step | 145 |

What the two runs show:

1. **All four planted problems appeared in both passes again.** Booking was
   Disjoint with the contradiction (3 findings) and the ownership conflict
   (2 findings). Calendar was Loose with the display-name warning and 2
   `unreached-step` findings for the owner-digest steps.
2. **Booking's timezone and unarchive steps are no longer flagged.** The earlier
   run flagged them because the prose never said they commit. They were a false
   positive: the room lock in Rooms commits. Booking now says "and commits", and
   those findings are gone.
3. **One `unreached-step` remains in booking.** It points at the availability-edit
   step "leaves every confirmed booking Confirmed", a step that does nothing. A
   child can reasonably leave it without an edge.
4. **Booking has new noise.** It has 8 or 9 `step-excluded-action` findings,
   mostly from the rule "Booking must not accept a booking request from the room
   owner". Children wrote it as a prohibition, and the submit flow's check on the
   room owner then trips it, although the flow is where the refusal happens. The
   guidance says to leave such a scoped rule as a reading. `unguarded-flow` rose
   to 26 and 29 for the same reason: more claims and few guard rows. None of
   these gate.
5. **Only `identity.sigil` was Coherent in both passes.** Slotted still has a
   real unmet obligation, because its prose never says it depends on SharedKernel.

No future run is guaranteed to match any of this.

### Earlier runs

Four earlier pairs of gradients ran on the same export under older guidance.
`analyze-demo/slotted-runs/DIAGNOSIS.md` holds the analysis of why each changed.
Each cell is pass 1 / pass 2.

| Source | Old guidance | Corrected naming rule | Four fixes | End declared by the prose |
| --- | --- | --- | --- | --- |
| `slotted.sigil` | Coherent / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `identity.sigil` | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent | Coherent / Coherent |
| `rooms.sigil` | Coherent / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `shared.sigil` | Loose / Loose | Loose / Loose | Loose / Loose | Loose / Loose |
| `availability.sigil` | Coherent / Coherent | Loose / Loose | Loose / Loose | Loose / Loose |
| `calendar.sigil` | Loose / Loose | Loose / Disjoint | Loose / Loose | Loose / Loose |
| `booking.sigil` | Disjoint / Coherent | Disjoint / Disjoint | Disjoint / Disjoint | Disjoint / Disjoint |

The guidance fingerprints were `29f869c7…`, `21f7aa54…`, `a0ce1299…`, and
`fbe42d67…`. The first run said a claim could only name an asterisk-marked Tag,
which cannot be done for an existing Tag, and booking's planted problems came
out in one pass of two. The third changed four readings: a Tag is never the
subject of "requires", "the only one that may" writes an exclusive property, a
rejection ends a flow, and a scoped exception is not a global ban. The fourth
changed the rule for flow ends: an end is declared by the prose, never by
position, and a commit counts as an end. Under that rule the owner-digest step
first showed as an unreached step, in the fifth run, which used the same design
as the first four. The design then changed once, in the sixth run above.

The run records stay outside the repository, except the copies in
`analyze-demo/slotted-runs/`, which are ignored by git.

## Remedies and the expected return state

The files keep the problems so you can rerun the demo. To try a repaired
design, work in a scratch copy:

1. Make Booking's interface and constraint agree about changing a pending range.
2. Keep the archived room mark in Rooms. Reword Booking so its workflows only
   call Rooms' archive and unarchive mutations.
3. Give the renter display name a provider, or remove the requirement.
4. Delete the owner digest step, or say what consumes it.

If those are the only defects, the repaired sources should return to Coherent
with no findings. The model may still report other findings, so run the loop on
the repaired copy instead of assuming a result. No repaired copy is committed.

## Computed evaluation and advisory review

The two tools answer different questions.

- **Computed evaluation** (`sigil-claims`) gives a Coherent, Loose, or Disjoint
  state for one source, structured findings, and an exit code you can gate on.
- **Advisory review** (`sigil-evaluate`) reads the design and returns prose. It
  gives no state and no gate.

Use the computed loop to gate on the claims the prose expresses. Use advisory
review to judge meaning, ownership, and consistency across the whole design.

A separate fresh `sigil-evaluate` reviewer read the same seven files, byte for
byte the ones the two gradients above used. It checked the digests of all seven
files before assessing. The review was design-only. It ran no tooling and did
not look at the claims results. Its read-only limit was instruction-only. It
returned ten findings. Four are the deliberate problems:

- **Contradiction (high).** The Booking interface offers a range change and a
  constraint forbids it.
- **Ownership (high).** Rooms and Booking both claim the archived room mark. The
  reviewer called this a determined correction toward Rooms owning the mark. It
  is kept as authored, because it is a deliberate fixture problem.
- **Unmet obligation (high).** Calendar requires a display name from Identity.
  Identity has none, and the dependency list omits Calendar on Identity.
- **Dead-end step (medium).** The owner digest step needs a stored previous
  digest, but Calendar is forbidden to store data.

The other six are real questions about the design that nobody planted:

- **Room lock audience (medium).** Rooms says the lock is for Booking's
  "workflows", which names only the four owner operations. Booking's status
  commands use it too.
- **Fall-back night (medium).** Calendar's wording excludes both occurrences of
  the repeated hour, though its own case excludes only the second.
- **Transactional entry (low).** Availability reuses a Tag that Rooms defines
  with Rooms-specific meaning.
- **Compare-and-set (low).** Booking requires it for every room-scoped mutation,
  but only status changes have an expected prior status.
- **Withdrawal (low).** A Slotted case says withdrawing makes the time requestable
  again, although a pending request never blocks.
- **Repeated number (low).** Calendar restates Booking's 180-day limit.

These six were not fixed, because any change to the design would have voided
the gradients above. Treat them as open items for whoever owns the design.

The advisory reviewer names the deliberate problems in prose. The computed loop
found all four in both passes, with a state and an exit code, but it also
reported many warnings that the reviewer did not. Neither replaces the other.
