import { match as matches, ok as assert } from "node:assert/strict";
import type { AttemptRecord, BatchManifest } from "./batch.ts";
import { SLOTTED_FIXTURE } from "./fixture.ts";
import { renderReport, type ReportAttempt } from "./report.ts";

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
  input: { frontendSha256: "snapshot" },
} as unknown as BatchManifest;

function attempt(
  id: string,
  status: AttemptRecord["status"],
  findings: unknown[],
  rowsText: string,
): ReportAttempt {
  const planned = manifest.schedule.find((row) => row.id === id)!;
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
    context: {
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
