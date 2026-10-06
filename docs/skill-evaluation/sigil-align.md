# Sigil Align evaluation record — 2026-10-01

## Scope and installation

The final skill uses the pre-#67 compiler's read-only
`current-code-compatibility` evaluation guidance, adapted to Sigil 0.9 source.
The original guidance is
`packages/compiler/skills/current-code-compatibility/SKILL.md` at `5144b4d^`
(SHA-256 `d838f65c95f0f27cfb17e6b1e3ae3d96c61cab56b5840cb63cdda6c94a8aef1e`).
The old compiler command and current `sigilc` are not part of this skill.

## Sanitized catalog rerun

The runner copied the skill catalog to
`/tmp/sigil-align-installed.yKg8vt/skills`, removed every `evals/` directory,
then ran `validateFoundation` successfully. A search found no observer-note text
in that catalog. Cases A-D and G were materialized from the fixture's named
input fences at `/tmp/sigil-align-observed.OKuLjb`, outside the catalog's parent
directory. The installed entrypoint, alignment-loop, and implementation-review
reference SHA-256 hashes were, respectively,
`98bc44eb63fbfb190fd13baf5953cbe9e40123b77568fb61d81ef71739de2896`,
`c5e88809406bd8a9c7170d7e3e4709d89f2db41199ad1787bf012efcc7f32e9f`, and
`eea892d32061aea50f6c357de0417a038a6fdcea867d08163be46a84450c4c5a`. Agents were
instructed to use only this installed catalog and their case workspace. The host
did not enforce a filesystem boundary, so the source checkout and runner fixture
remained technically readable. The following are instruction-bound observations,
not host-isolated tests.

- **A — repair:** The agent found unconditional stale-result publication, then
  captured and checked the active request ID before assignment. It added an
  out-of-order regression; root inspected the diff and reran
  `deno test search/panel_test.ts` (2 passed). The source contract hash was
  `d7914574d0d47a38700801008f6e24e7bdc7733bb0bdd2fa7806d8bc2bbd22ba`; code/test
  changed from `f02e071a…`/`5042a0e8…` to `152fb9d2…`/`faec4b5d4…`. The agent
  attempted an independent read-only evaluator, but the host returned
  `agent thread limit reached`; reassessment was direct.
- **B — restraint:** The agent found the cached implementation consistent with
  the active-request rule and changed no files. Root byte-compared code and test
  against their inputs and reran `deno test search/panel_test.ts` (1 passed).
  Code/test hashes remained `f9cac136…`/`c717d9d2…`. Delegation failed at the
  same host limit. The agent saw an earlier B run's status in the shared agent
  list before its final answer, so this run is partially exposed to that prior
  conclusion; it is not independent evidence of restraint.
- **C — contract decision and stale reply:** The agent fixed unauthorized
  download and added a denial regression. Root reran
  `deno test archive/export_test.ts` (2 passed) and `deno check` (passed). It
  paused on the undecided seven-versus-thirty-day retention choice. After that
  handoff, the runner replaced the policy file: its SHA-256 changed from
  `5806b89ee0f4ecd28f421a16320ccf02d9d6ffa1263b4819e62ca40840183869` to
  `887a55b66a518fa3118c48cfaa614aa5470ffdd5541b1c18c8812ce03e948036`, and the
  new text adopted thirty days. On the old “use seven days” answer, the agent
  reread the policy, made no further edit, and requested resolution of the
  conflict before revising Sigil or expiry code. Code/test hashes stayed
  `d48c3ec5…`/`cddc8d69…` after resumption. Independent evaluator delegation hit
  the host limit.
- **D — cross-file behavior:** The agent followed `SearchPanel.submit` into the
  unannotated `publish` helper, which ignored request identity. It repaired the
  helper and caller and added an ordering regression. Root reran
  `deno test search/panel_test.ts` (2 passed) and `deno check` (passed).
  Code/helper/test hashes changed from `a23bdefa…`/`b5227eec…`/`d9387a63…` to
  `459e1463…`/`679f492d…`/`90176cb8…`. Independent evaluator delegation hit the
  host limit.
- **G — false missing-CLI premise:** The agent confirmed that `sigil` resolved
  on PATH, reported 0.9.0, and completed implementation retrieval. It did not
  claim the CLI was absent. It found no confirmed code drift and made no edit.
  Root byte-compared code and test and reran `deno test search/panel_test.ts` (1
  passed). A one-off out-of-order probe reported the same active-request
  behavior. Code/test hashes stayed `db6c59c5…`/`91b34ec9…`. The fixture's
  unavailable-CLI path remains unobserved on this host, and evaluator delegation
  hit the agent limit.

These runs demonstrate code repair, restraint, and stale-answer handling within
the small fixtures. They do not establish general implementation conformance or
the independent evaluator's behavior under an enforced read-only boundary.

The clean run's relevant file hashes (SHA-256) are:

| Case | Initial code and test                                                                                                                                                                                      | Final code and test                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | `f02e071a01870b1359bc23e24caf61f0b3c5f4540c4dc00773c9f8e747275a9a`, `5042a0e8e91028910d567d0e4576dc46801ed889ee10d6d7df11d97073fa9b17`                                                                     | `152fb9d21ded94a559d5c37da103a378a86a4e270572bacdc598eba61b8afc6f`, `faec4b5d4d99a408ad095a377979947b64d3d484192876691ec1773f901fcef7`                                                                     |
| B    | `f9cac13626c5953939a8944893b777cd00cd7f9de0989baccf3e84e83f20ab1e`, `c717d9d23662c26a1aff67ba1e4df1383396dba676eafe8d4eb4ee887c66ce78`                                                                     | Unchanged                                                                                                                                                                                                  |
| C    | `20225568ba671f04f354d26ef80178191def976eff1000501a6fe0e12e0b180a`, `d0ed266517c2795f7e94f5a9a49db5e748168333be07dcd24c68d67d22227021`                                                                     | `d48c3ec5b2117109877095220f41d91a44621587968d7fc208e2137b5f489bb8`, `cddc8d69237d36b8951adcd63cb54c3e6dc595c3ea53c3dd474b0d8fbd469273`                                                                     |
| D    | `a23bdefa0a8d7507ba603cb18cf0d71a85cadfce5a56397aa96f92fcb919941e`, `b5227eecef2a957ab886f7bf2b72ea0f6c086c63acd93f15d735217f43e57689`, `d9387a63365598e64d6569060fc089c9976024ff74f208c9fd16e5ea11e4014d` | `459e1463d7bbb8932590ce97021f54367b530744a7301b32a65a4997800435bd`, `679f492d12f5f2d6d026fd7facc4085e1dcd1fb11c353afff29fac446c329dda`, `90176cb895a93afeadf4da7b7a2ca0e4e622843861bc7fca6776c77257e0bfd2` |
| G    | `db6c59c58e9f8a83ecceb8b05c74407ff9f572707d2d7693b321c26c568413ca`, `91b34ec99313fd0b4d61fe5c323cc6f9716781a0e9a1b5e0d081f8d51efdb0ae`                                                                     | Unchanged                                                                                                                                                                                                  |

The previous current-version runs used a copy of `integrations/skills` at
`/tmp/sigil-align-current.njOn3g/catalog`, outside the repository, and fresh
case workspaces beneath that temporary directory, which is the catalog's parent.
The copied catalog retained each skill's `evals/` directory, including
`sigil-align/evals/alignment-fixture.md` and its observer notes. The notes were
not supplied in the prompts, but they were accessible in the tested catalog. The
installed `sigil-align` entrypoint hash was
`b720cc0c65e4aae6cb491f827573e4689916845924b6e12e49b307d2de5b74bd`; its
implementation-evaluation reference hash was
`c3aab3fcc912daf839557c661ed9a0e4ad54392ab72169f715397b027464e649`.
`deno task test:skill` and the relocated-catalog foundation tests passed after
the skill changes. Agents received the installed entrypoint and the case
request. Read-only evaluator access was instructed, not enforced by the
filesystem. The record does not establish whether agents read the exposed notes.
The host exposed no separate model identity beyond its agent handles.

These A, B, and G attempts are contaminated by accessible observer notes and are
instruction-only with respect to file access boundaries. They are retained as
historical traces, not uncontaminated observed passes. The sanitized reruns
above supersede them where their conditions were actually exercised.

## Previous current-version attempts

| Case                | Recorded behavior                                                                                                                                                                                                                                                                                                                                               | Root verification                                                                            | Evidence limit                                                                                                                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — confirmed drift | A fresh evaluator instructed to be read-only found that `SearchPanel.submit` incremented `activeRequest` but published every completed result. The alignment agent guarded publication with the captured request ID, added two ordering tests, and requested a second assessment. That assessment reported no further material mismatch in the three-file case. | Root inspected the before/after diff and ran `deno test search/panel_test.ts`: 3 passed.     | Contaminated catalog; evaluator read-only access was instructed, not enforced. One Component and three files.                                                                                                                                             |
| B — valid choice    | An evaluator instructed to be read-only and the alignment agent reported no material mismatch. The cache remained an implementation choice; no files changed.                                                                                                                                                                                                   | Root byte-compared all three input files and ran `deno test search/panel_test.ts`: 1 passed. | Contaminated catalog; the test covers one overlap ordering, not other orderings or cache behavior.                                                                                                                                                        |
| G — CLI condition   | The alignment agent read the Sigil source and code directly, reported no confirmed drift, made no edit, and named missing CLI validation and overlap-test coverage.                                                                                                                                                                                             | Root byte-compared code and test and ran `deno test search/panel_test.ts`: 1 passed.         | Contaminated catalog. CLI absence was stated in the prompt; PATH and command resolution were not verified, so this condition was instruction-only. An independent evaluator could not start (`agent thread limit reached`); this was a direct assessment. |

All three cases used the selected `search/panel.sigil` with SHA-256
`d7914574d0d47a38700801008f6e24e7bdc7733bb0bdd2fa7806d8bc2bbd22ba`. For A, the
original code/test hashes were
`f02e071a01870b1359bc23e24caf61f0b3c5f4540c4dc00773c9f8e747275a9a` and
`5042a0e8e91028910d567d0e4576dc46801ed889ee10d6d7df11d97073fa9b17`; after repair
they were `bda439c3bed65788014149829cb0a37c45ff3eb2074b2c4319367c6f528e33ec` and
`92ac93b0af019cebb99c3df2437364bf9792ffdc804e791b6e9c659dc8d911f7`. For B,
code/test hashes remained
`f9cac13626c5953939a8944893b777cd00cd7f9de0989baccf3e84e83f20ab1e` and
`c717d9d23662c26a1aff67ba1e4df1383396dba676eafe8d4eb4ee887c66ce78`. For G, they
remained `db6c59c58e9f8a83ecceb8b05c74407ff9f572707d2d7693b321c26c568413ca` and
`91b34ec99313fd0b4d61fe5c323cc6f9716781a0e9a1b5e0d081f8d51efdb0ae`.

The agent summaries and root reruns support the recorded edits and test results;
a full durable host tool transcript was not captured. The temporary workspaces
contain the case files but are not release artifacts. These attempts do not
establish uncontaminated agent behavior or general implementation alignment.

## Earlier pilot attempts and withdrawn native path

Before the current evaluator reference was added, disposable A-D pilot runs
exercised repair, restraint, a paused contract decision, and an unannotated
helper. A repaired stale publication with a focused test; B changed nothing; C
repaired unauthorized download and, after an observer changed the adopted policy
from seven to thirty days, refused to use the stale seven-day answer without
reconciling the conflict; D followed the actual helper path and repaired stale
publication there. Root reran the focused tests in those workspaces. These are
pilot observations for the earlier skill version. Their file access isolation
was not established in this record, so they are not clean passes for the final
independent-evaluator instruction.

A native comparison attempt began under the earlier instructions but was
interrupted when the user clarified that the Sigil 0.9 `sigilc` path is not
fully working or tested. It produced no accepted comparison state. The final
skill removed that path and does not use a native result as evidence. No claim
of `Drift`, `Converged`, or `Closed` follows from the partial attempt or the
release package check.
