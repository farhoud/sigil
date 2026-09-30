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

- Semantic export digest: `11cc16a1ff0088f8cb2658e481d725fed34a4ffb1a1b5b27a3ea5de5abaaafeb`
- Raw export SHA-256: `b354dcca33f23796f3063cc364bcd4ea97dd008f8388aa651d83245c3cb4ff52`
- Source-byte manifest SHA-256: `f857684ac3618b90426db81d9e56a99ae8f4cdacc93dcef21398f94d21b7588b`
- Guidance fingerprint: `a0ce12995dc8127d7629890b7f0986c985f88f282a08c82d469d2c3cc1cf5555`

The seven source files matched the manifest before both passes. Every prepare
reused zero units. The host limits were instruction-only. Each child was told
to read only its prepared files and write only its own artifact. No operating
system sandbox was enforced. All 14 counted results passed the identity checks
above. I did not recompute the per-artifact BLAKE3 digests.

One run was refused and is not counted. The first booking pass-1 child gave two
Rooms steps the same ordinal, and the tool refused the artifact. A refused
artifact gives no state. A second fresh child ran for that slot, and its result
is the one below.

| Source | Target | Pass 1 | Pass 2 | Facets presented |
| --- | --- | --- | --- | ---: |
| `slotted.sigil` | Coherent / 0 | Loose / 0, 3 unmet-obligation | Loose / 0, 1 unmet-obligation, 5 ungrounded-claim | 168 |
| `identity.sigil` | Coherent / 0 | Coherent / 0, none | Coherent / 0, none | 16 |
| `rooms.sigil` | Coherent / 0 | Loose / 0, 4 unguarded-flow | Loose / 0, 3 unguarded-flow | 40 |
| `shared.sigil` | Coherent / 0 | Loose / 0, 1 unguarded-flow | Loose / 0, 1 unguarded-flow | 18 |
| `availability.sigil` | Coherent / 0 | Loose / 0, 5 unguarded-flow | Loose / 0, 1 unmet-obligation, 8 unguarded-flow | 81 |
| `calendar.sigil` | Loose / 0, unmet-obligation and unreached-step | Loose / 0, 1 unmet-obligation, 1 ungrounded-claim, 2 unguarded-flow | Loose / 0, 1 unmet-obligation | 170 |
| `booking.sigil` | Disjoint / 1, contradiction and ownership conflict | Disjoint / 1, 3 contradiction, 2 ownership-conflict, 1 unmet-obligation, 1 ungrounded-claim, 1 uninterpreted-section, 19 unguarded-flow | Disjoint / 1, 3 contradiction, 2 ownership-conflict, 3 unguarded-flow | 145 |

What the two runs show:

1. **Booking was Disjoint in both passes, with both gating problems each
   time.** Each pass found the contradiction over the range change (3 findings)
   and the ownership conflict over the archived room mark (2 findings, one from
   each side).
2. **Calendar's unmet obligation appeared in both passes.** The display-name
   requirement was reported each time. The dead-end step never produced an
   `unreached-step` in either pass, so that planted problem is not shown. Its
   step is the last step of its paragraph, so a child always gives it an end.
3. **Calendar was Loose in both passes.** No unintended Disjoint this time.
4. **Only `identity.sigil` was Coherent in both passes.** The other sources that
   should be Coherent were Loose. Most of it is `unguarded-flow`: a constraint
   names something, such as the room lock or the clock, that no step checks.
   These warnings do not gate. Slotted also has a real unmet obligation: it
   requires the domain error, but its prose never says it depends on
   SharedKernel. Slotted pass 2 has 5 ungrounded claims about Tags it does not
   import.

No future run is guaranteed to match any of this. Children still differ in how
many claims they make and how they connect flow steps.

### Earlier runs

Two earlier pairs of gradients ran on the same export, under older guidance.
Both are kept as short records. `analyze-demo/slotted-runs/DIAGNOSIS.md` holds
the analysis of why they differed.

**Old guidance** (said a claim may only name an asterisk-marked Tag, which
cannot be done for an existing Tag). Fingerprint `29f869c7…`.

| Source | Pass 1 | Pass 2 |
| --- | --- | --- |
| `slotted.sigil` | Coherent | Loose |
| `identity.sigil` | Coherent | Coherent |
| `rooms.sigil` | Coherent | Loose |
| `shared.sigil` | Loose | Loose |
| `availability.sigil` | Coherent | Coherent |
| `calendar.sigil` | Loose | Loose |
| `booking.sigil` | Disjoint | Coherent |

**Corrected naming rule, before the four later fixes.** Fingerprint `21f7aa54…`.

| Source | Pass 1 | Pass 2 |
| --- | --- | --- |
| `slotted.sigil` | Loose | Loose |
| `identity.sigil` | Coherent | Coherent |
| `rooms.sigil` | Loose | Loose |
| `shared.sigil` | Loose | Loose |
| `availability.sigil` | Loose | Loose |
| `calendar.sigil` | Loose | Disjoint |
| `booking.sigil` | Disjoint | Disjoint |

In the old-guidance run, booking's problems appeared in one pass of two. The
corrected naming rule fixed that. Booking's ownership conflict still appeared
in only one of the two passes until the exclusive-ownership fix, and calendar
went Disjoint once because a scoped exception was read as a global ban. Both
are fixed in the latest run.

The run records stay outside the repository, except the copies in
`analyze-demo/slotted-runs/`.

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
byte the ones the two gradients used. The review was design-only. It ran no
tooling and did not look at the claims results. Its read-only limit was
instruction-only. It returned ten findings. Four are the deliberate problems:

- **Contradiction (high).** The Booking interface offers a range change and a
  constraint forbids it.
- **Ownership (high).** Rooms and Booking both claim the archived room mark.
  The reviewer noted that the rest of the design points to Rooms.
- **Unmet obligation (high).** Calendar requires a display name from Identity.
  Identity has none, and the dependency list omits Calendar on Identity.
- **Dead-end step (medium).** The owner digest step needs a stored previous
  digest, but Calendar is forbidden to store data.

The other six are real questions about the design that nobody planted:

- **Public bookings read.** Booking's read of a room's bookings has no stated
  audience, so masking exists only in Calendar (medium).
- **Fall-back night.** It is unclear whether a booking may span the repeated
  hour on a daylight-saving fall-back night (medium).
- **Archive and expired requests.** It is unclear whether archiving declines
  expired requests (low).
- **Slotted's plain wording.** It could import the owning modules' Tags instead
  of saying the same things in plain words (low).
- **Domain errors.** Identity, Rooms, and Availability do not visibly reference
  the shared domain error (low).
- **Repetition.** Booking restates several rules in both logic and constraints
  (low).

These six were not fixed, because any change to the design would have voided
both gradients above. Treat them as open items for whoever owns the design.

The advisory reviewer names the deliberate problems in prose. The computed loop
found some of them in some runs, with a state and an exit code. Neither
replaces the other.
