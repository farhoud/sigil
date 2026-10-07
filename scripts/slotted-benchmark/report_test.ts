import { match as matches, ok as assert } from "node:assert/strict";
import type { AttemptRecord, BatchManifest } from "./batch.ts";
import { SLOTTED_FIXTURE } from "./fixture.ts";
import { renderReport, type ReportAttempt, writeReport } from "./report.ts";

const fixtureIssues = SLOTTED_FIXTURE.issues.map((issue, index) => ({
  ...issue,
  status: "scorable" as const,
  reason: null,
  facets: index === 0
    ? ["F-range-interface", "F-range-constraint"]
    : index === 1
    ? ["F-booking-mark", "F-rooms-mark"]
    : index === 2
    ? ["F-display"]
    : ["F-digest"],
}));
const manifest = {
  version: 1,
  createdAt: "2026-10-02T00:00:00Z",
  fixture: SLOTTED_FIXTURE,
  preflight: { canSchedule: true, sourceDrift: [], issues: fixtureIssues },
  schedule: [
    {
      id: "000001",
      agent: "claude",
      model: "sonnet",
      pass: 1,
      source: "booking.sigil",
    },
    {
      id: "000002",
      agent: "claude",
      model: "sonnet",
      pass: 2,
      source: "booking.sigil",
    },
    {
      id: "000003",
      agent: "claude",
      model: "sonnet",
      pass: 3,
      source: "booking.sigil",
    },
  ],
  input: { workspaceDigest: "snapshot" },
} as unknown as BatchManifest;

function attempt(
  id: string,
  status: AttemptRecord["status"],
  findings: unknown[],
  rowsText: string,
  attemptManifest: BatchManifest = manifest,
  context: Record<string, unknown> = {
    units: [
      {
        facet: "F-range-interface",
        asserted: [{ claim: "witness-1", body: { kind: "claim" } }],
      },
      {
        facet: "F-range-constraint",
        asserted: [{ claim: "witness-2", body: { kind: "claim" } }],
      },
    ],
  },
): ReportAttempt {
  const planned = attemptManifest.schedule.find((row) => row.id === id)!;
  const record = {
    ...planned,
    status,
    startedAt: "start",
    finishedAt: "end",
    state: status === "valid" ? "disjoint" : null,
    failureStep: status === "valid" ? null : "validation",
    error: status === "valid" ? null : "incomplete Facet coverage",
    observedModels: ["claude-sonnet-observed"],
    modelVerification: "observed",
    presentedFacets: 2,
    coveredFacets: status === "valid" ? 2 : 1,
    outcomePath: `attempts/${id}/outcome.json`,
  } as AttemptRecord;
  const outcome = {
    status,
    state: record.state,
    report: { source: "booking.sigil", state: "disjoint", findings },
    context,
    agent: {
      finalResponsePath: `attempts/${id}/evidence/child/final-response.txt`,
    },
  };
  return { record, outcome, rowsText };
}

Deno.test("same-state runs show evidence-based 1/2 detection, extras, and exact Facet row variation", () => {
  const contradiction = {
    class: "contradiction",
    law: "contradictory-claims",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    claims: ["witness-1"],
  };
  const extra = {
    class: "flow",
    law: "unguarded-flow",
    subject: "some-step",
    object: "urn:sigil:component:rooms.sigil:Rooms",
    claims: ["witness-2"],
  };
  const first = attempt("000001", "valid", [contradiction, {
    ...contradiction,
    claims: ["witness-2"],
  }], '(claim "F-range-interface" "A" "provides" "B" "required" "true")\n');
  const second = attempt(
    "000002",
    "valid",
    [extra],
    '(reading "F-range-interface" "no-commitment")\n',
  );
  const failed = attempt("000003", "invalid", [contradiction], "");
  const report = renderReport(manifest, [first, second, failed]);
  matches(report, /booking-pending-range-contradiction: 1\/2/);
  matches(report, /native finding 1, 2/);
  matches(report, /unguarded-flow/);
  matches(report, /F-range-interface/);
  matches(report, /\(claim "F-range-interface"/);
  matches(report, /\(reading "F-range-interface"/);
  matches(report, /000003.*invalid/);
  assert(!report.includes("false positive"));
  assert(!report.includes("Overall rank"));
});

Deno.test("comparison reports the frequency of each distinct additional finding", () => {
  const firstExtra = {
    class: "flow",
    law: "unreached-step",
    subject: "witness-1",
    object: "urn:example:first-effect",
    claims: ["witness-1"],
  };
  const secondExtra = {
    ...firstExtra,
    subject: "witness-2",
    object: "urn:example:second-effect",
    claims: ["witness-2"],
  };
  const report = renderReport(manifest, [
    attempt("000001", "valid", [firstExtra], ""),
    attempt("000002", "valid", [secondExtra], ""),
  ]);

  matches(
    report,
    /Planted problem detection \| Additional finding frequencies/,
  );
  matches(
    report,
    /flow \/ unreached-step \/ Facet F-range-interface \/ urn:example:first-effect: 1\/2/,
  );
  matches(
    report,
    /flow \/ unreached-step \/ Facet F-range-constraint \/ urn:example:second-effect: 1\/2/,
  );
});

Deno.test("Calendar planted findings require the intended facet and evidence identity", () => {
  const calendarManifest = {
    ...manifest,
    schedule: [
      {
        id: "000004",
        agent: "claude",
        model: "sonnet",
        pass: 1,
        source: "calendar.sigil",
      },
    ],
  } as unknown as BatchManifest;
  const unmet = SLOTTED_FIXTURE.issues.find((issue) =>
    issue.id === "calendar-display-name-unmet-obligation"
  )!;
  const flow = SLOTTED_FIXTURE.issues.find((issue) =>
    issue.id === "calendar-owner-digest-unreached-step"
  )!;
  const calendarContext = {
    units: [
      {
        facet: "F-display",
        asserted: [{ claim: "display-claim" }],
      },
      {
        facet: "F-digest",
        asserted: [{ claim: "digest-claim" }],
      },
      {
        facet: "F-unrelated",
        asserted: [{ claim: "unrelated-claim" }],
      },
    ],
  };
  const obligation = {
    class: unmet.findingClass,
    law: unmet.laws[0],
    subject: unmet.findingEvidence.subject,
    object: unmet.findingEvidence.object,
    claims: ["display-claim"],
  };
  const flowFinding = {
    class: flow.findingClass,
    law: flow.laws[0],
    subject: "digest-claim",
    object: flow.findingEvidence.object,
    claims: ["digest-claim"],
  };

  const positive = renderReport(calendarManifest, [
    attempt(
      "000004",
      "valid",
      [obligation, flowFinding],
      "",
      calendarManifest,
      calendarContext,
    ),
  ]);
  matches(positive, /calendar-display-name-unmet-obligation: 1\/1/);
  matches(positive, /calendar-owner-digest-unreached-step: 1\/1/);
  matches(positive, /No additional findings in valid attempts\./);

  const invalidFindings: Array<{ label: string; finding: unknown }> = [
    {
      label: "unrelated Facet witness",
      finding: { ...obligation, claims: ["unrelated-claim"] },
    },
    {
      label: "unknown Facet witness",
      finding: { ...obligation, claims: ["unknown-claim"] },
    },
    {
      label: "wrong obligation subject",
      finding: { ...obligation, subject: "urn:example:wrong-subject" },
    },
    {
      label: "wrong obligation object",
      finding: { ...obligation, object: "urn:example:wrong-object" },
    },
    {
      label: "wrong flow object",
      finding: { ...flowFinding, object: "urn:example:wrong-object" },
    },
    {
      label: "flow subject absent from cited claims",
      finding: { ...flowFinding, subject: "other-claim" },
    },
  ];
  for (const { label, finding } of invalidFindings) {
    const report = renderReport(calendarManifest, [
      attempt(
        "000004",
        "valid",
        [finding],
        "",
        calendarManifest,
        calendarContext,
      ),
    ]);
    matches(
      report,
      /calendar-display-name-unmet-obligation: 0\/1/,
      label,
    );
    matches(
      report,
      /calendar-owner-digest-unreached-step: 0\/1/,
      label,
    );
    matches(report, /\| valid \| disjoint \| — \| 1 \|/u, label);
    matches(report, /## Additional findings for review/);
    matches(report, /- Attempt 000004, finding 1:/, label);
  }
});

Deno.test("moved batch report uses retained rows and links inside the moved batch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-report-move-" });
  const originalDir = `${root}/original`;
  const movedDir = `${root}/moved`;
  const planned = manifest.schedule[0];
  const base = attempt("000001", "valid", [
    {
      class: "contradiction",
      law: "contradictory-claims",
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
      claims: ["witness-1"],
    },
  ], '(claim "F-range-interface" "A" "provides" "B" "required" "true")\n');
  const oldReportPath =
    `${originalDir}/attempts/000001/private/.sigil/claims/booking.sigil.json`;
  const oldContextPath =
    `${originalDir}/attempts/000001/private/.sigil/claims/booking.sigil.context.json`;
  const outsideRowsPath = `${root}/outside-rows.txt`;
  const batchManifest = { ...manifest, schedule: [planned] };
  const record = {
    ...base.record,
    outcomePath: "attempts/000001/outcome.json",
  };
  const outcome = {
    ...base.outcome,
    agent: { finalResponsePath: outsideRowsPath },
    ingestResult: {
      report: oldReportPath,
      judgmentContext: oldContextPath,
    },
  };

  try {
    await Deno.mkdir(`${originalDir}/records`, { recursive: true });
    await Deno.mkdir(`${originalDir}/attempts/000001/evidence/child`, {
      recursive: true,
    });
    await Deno.mkdir(`${originalDir}/attempts/000001/private/.sigil/claims`, {
      recursive: true,
    });
    await Deno.writeTextFile(
      `${originalDir}/manifest.json`,
      JSON.stringify(batchManifest),
    );
    await Deno.writeTextFile(
      `${originalDir}/records/000001.json`,
      JSON.stringify(record),
    );
    await Deno.writeTextFile(
      `${originalDir}/attempts/000001/outcome.json`,
      JSON.stringify(outcome),
    );
    await Deno.writeTextFile(
      `${originalDir}/attempts/000001/evidence/child/final-response.txt`,
      base.rowsText!,
    );
    await Deno.writeTextFile(outsideRowsPath, base.rowsText!);
    await Deno.writeTextFile(
      `${originalDir}/attempts/000001/private/.sigil/claims/booking.sigil.json`,
      "{}\n",
    );
    await Deno.writeTextFile(
      `${originalDir}/attempts/000001/private/.sigil/claims/booking.sigil.context.json`,
      "{}\n",
    );
    await Deno.rename(originalDir, movedDir);
    const victim = `${root}/outside.md`;
    await Deno.writeTextFile(victim, "keep this file intact\n");
    await Deno.symlink(victim, `${movedDir}/report.md`);

    const reportPath = await writeReport(movedDir);
    const report = await Deno.readTextFile(reportPath);
    assert(!(await Deno.lstat(reportPath)).isSymlink);
    assert(await Deno.readTextFile(victim) === "keep this file intact\n");
    assert(!(await pathExists(originalDir)), "old batch location still exists");
    matches(report, /`booking\.sigil` \| valid \| disjoint \|/);
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /\]\(attempts\/000001\/evidence\/child\/final-response\.txt\)/,
    );
    matches(
      report,
      /\]\(attempts\/000001\/private\/\.sigil\/claims\/booking\.sigil\.json\)/,
    );
    matches(
      report,
      /\]\(attempts\/000001\/private\/\.sigil\/claims\/booking\.sigil\.context\.json\)/,
    );
    await Deno.remove(
      `${movedDir}/attempts/000001/evidence/child/final-response.txt`,
    );
    const evidenceMissing = await writeReport(movedDir);
    const missingReport = await Deno.readTextFile(evidenceMissing);
    matches(missingReport, /\| invalid \|/);
    assert(!missingReport.includes("outside-rows.txt"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

Deno.test("one ownership witness counts when both fixture anchors are intact", () => {
  const ownership = {
    class: "ownership-conflict",
    law: "exclusive-ownership",
    subject: "urn:sigil:component:booking.sigil:Booking",
    object: "urn:sigil:component:rooms.sigil:Rooms",
    claims: ["mark-witness"],
  };
  const base = attempt(
    "000001",
    "valid",
    [ownership],
    '(property "F-booking-mark" "Booking" "exclusive" "true")\n',
  );
  const outcome = {
    ...base.outcome,
    context: {
      units: [
        { facet: "F-booking-mark", asserted: [{ claim: "mark-witness" }] },
      ],
    },
  };
  const report = renderReport(manifest, [{ ...base, outcome }]);
  matches(report, /booking-rooms-archived-mark-ownership: 1\/1/);
});

Deno.test("observed, unverified, and mixed model identities remain separate groups", () => {
  const base = attempt("000001", "valid", [], "");
  const unverified = attempt("000002", "valid", [], "");
  const mixed = attempt("000003", "valid", [], "");
  const report = renderReport(manifest, [
    base,
    {
      ...unverified,
      record: {
        ...unverified.record,
        observedModels: [],
        modelVerification: "unverified",
      },
    },
    {
      ...mixed,
      record: {
        ...mixed.record,
        observedModels: ["model-a", "model-b"],
        modelVerification: "mixed",
      },
    },
  ]);
  matches(report, /claude-sonnet-observed \(observed\)/);
  matches(report, /model-a, model-b \(mixed\)/);
  matches(report, /\| unverified \| `booking\.sigil` \|/);
});

Deno.test("interrupted attempts are counted separately from failures", () => {
  const report = renderReport(manifest, [
    attempt("000001", "interrupted", [], ""),
    attempt("000002", "valid", [], ""),
    attempt("000003", "valid", [], ""),
  ]);
  matches(
    report,
    /\| claude \| sonnet \| claude-sonnet-observed \(observed\) \| `booking\.sigil` \| 3 \| 2 \| 0 \/ 0 \/ 1 \/ 0 \|/,
  );
  matches(report, /\| 000001 \| claude \| sonnet \|.*\| interrupted \|/);
});

Deno.test("drift withholds one issue metric while states remain visible", () => {
  const drifted = {
    ...manifest,
    preflight: {
      ...manifest.preflight,
      issues: manifest.preflight.issues.map((issue) =>
        issue.id === "booking-rooms-archived-mark-ownership"
          ? {
            ...issue,
            status: "drift" as const,
            reason: "Booking anchor missing",
            facets: [],
          }
          : issue
      ),
    },
  };
  const report = renderReport(drifted, [attempt("000001", "valid", [], "")]);
  matches(report, /booking-rooms-archived-mark-ownership: N\/A/);
  matches(report, /disjoint/);
});
