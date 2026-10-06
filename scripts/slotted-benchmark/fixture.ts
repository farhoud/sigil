import type { DesignInput } from "../../packages/core/src/design-input.ts";

export interface FixtureSource {
  readonly path: string;
  readonly role: string;
  readonly imports: readonly string[];
  readonly target: {
    readonly state: "Coherent" | "Loose" | "Disjoint";
    readonly exitCode: 0 | 1;
  };
}

export interface EvidenceAnchor {
  readonly source: string;
  readonly section: string;
  readonly text: string;
}

export interface FixtureIssue {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly findingClass:
    | "contradiction"
    | "ownership-conflict"
    | "unmet-obligation"
    | "flow";
  readonly laws: readonly string[];
  readonly findingEvidence: {
    /** Exact native subject URI, or the ID of a cited claim for flow findings. */
    readonly subject: string | "cited-claim";
    readonly object: string;
    readonly eitherDirection?: true;
  };
  readonly remedy: string;
  readonly anchors: readonly EvidenceAnchor[];
  readonly requiresAbsentIdentityDisplayNameProvider?: true;
}

export interface PreparedFacetRequest {
  readonly binding: { readonly source: string };
  readonly rows: readonly {
    readonly facet: string;
    readonly source: string;
    readonly section: string;
    readonly prose: string;
  }[];
}

export interface IssuePreflight extends FixtureIssue {
  readonly status: "scorable" | "drift";
  readonly reason: string | null;
  /** Facet IDs resolved from this export, in the same order as anchors. */
  readonly facets: readonly string[];
}

export interface FixturePreflight {
  readonly canSchedule: boolean;
  readonly sourceDrift: readonly string[];
  readonly issues: readonly IssuePreflight[];
}

/** The benchmark's versioned Slotted answer key. Never passed to an interpretation child. */
export const SLOTTED_FIXTURE: {
  readonly version: 1;
  readonly description: string;
  readonly sources: readonly FixtureSource[];
  readonly issues: readonly FixtureIssue[];
} = {
  version: 1,
  description:
    "Slotted is a room-booking design: people own rooms and rent other people's rooms, with owner approval of requests. SharedKernel is a kernel rather than a module.",
  sources: [
    {
      path: "slotted.sigil",
      role: "The app: module list, dependency rules, technology stack",
      imports: ["Identity", "Rooms", "Availability", "Booking", "SharedKernel"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "identity.sigil",
      role: "User accounts, sessions, the signed-in user, requireUser",
      imports: [],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "rooms.sigil",
      role: "Rooms, room owners, room timezone, archiving, the room lock",
      imports: ["Identity"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "shared.sigil",
      role: "The kernel: clock, 30-minute grid, time conversion, domain errors",
      imports: [],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "availability.sigil",
      role: "Weekly windows, blackouts, open time",
      imports: ["Identity", "Rooms", "SharedKernel"],
      target: { state: "Coherent", exitCode: 0 },
    },
    {
      path: "booking.sigil",
      role:
        "Booking requests, their lifecycle, the no-overlap rule, owner workflows",
      imports: ["Identity", "Rooms", "Availability", "SharedKernel"],
      target: { state: "Disjoint", exitCode: 1 },
    },
    {
      path: "calendar.sigil",
      role: "The room calendar, with masking by viewer",
      imports: ["Rooms", "Availability", "Booking", "SharedKernel"],
      target: { state: "Loose", exitCode: 0 },
    },
  ],
  issues: [
    {
      id: "booking-pending-range-contradiction",
      title: "Pending request range change contradiction",
      explanation:
        "Booking's interface offers a renter a range change for their pending request, while its constraint forbids that range change.",
      findingClass: "contradiction",
      laws: ["contradictory-claims", "negated-claim-holds"],
      findingEvidence: {
        subject: "urn:sigil:component:booking.sigil:Booking",
        object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
      },
      remedy:
        "Decide whether a pending range may change, then make the interface and constraint agree.",
      anchors: [
        {
          source: "booking.sigil",
          section: "interface",
          text:
            "Booking provides a renter a *range change* of their own pending request",
        },
        {
          source: "booking.sigil",
          section: "constraints",
          text: "Booking must not provide a range change of a pending request",
        },
      ],
    },
    {
      id: "booking-rooms-archived-mark-ownership",
      title: "Archived room mark ownership conflict",
      explanation:
        "Booking claims exclusive control of the archived room mark, while Rooms also claims ownership of that mark.",
      findingClass: "ownership-conflict",
      laws: ["exclusive-ownership"],
      findingEvidence: {
        subject: "urn:sigil:component:booking.sigil:Booking",
        object: "urn:sigil:component:rooms.sigil:Rooms",
        eitherDirection: true,
      },
      remedy:
        "Keep the mark in Rooms. Reword Booking so its workflows call Rooms' archive and unarchive mutations.",
      anchors: [
        {
          source: "booking.sigil",
          section: "constraints",
          text:
            "Booking owns the archived room mark, and Booking is the only one that may set",
        },
        {
          source: "rooms.sigil",
          section: "state",
          text: "Rooms owns the archived room\n    mark",
        },
      ],
    },
    {
      id: "calendar-display-name-unmet-obligation",
      title: "Renter display name without a provider",
      explanation:
        "Calendar requires each renter's display name from Identity, which supplies no display-name provider.",
      findingClass: "unmet-obligation",
      laws: ["unmet-obligation"],
      findingEvidence: {
        subject: "urn:sigil:component:calendar.sigil:Calendar",
        object:
          "urn:sigil:component:calendar.sigil:Calendar:tag:renter%20display%20name",
      },
      remedy:
        "Give Identity a display name and interface, return the label from Booking, or use the email.",
      anchors: [
        {
          source: "calendar.sigil",
          section: "constraints",
          text:
            "Calendar requires the *renter display name* of each renter from Identity",
        },
      ],
      requiresAbsentIdentityDisplayNameProvider: true,
    },
    {
      id: "calendar-owner-digest-unreached-step",
      title: "Owner digest comparison without an effect",
      explanation:
        "Calendar compares the owner digest with the previous digest, but the step writes and returns nothing.",
      findingClass: "flow",
      laws: ["unreached-step"],
      findingEvidence: {
        subject: "cited-claim",
        object: "urn:sigil:component:calendar.sigil:Calendar",
      },
      remedy: "Delete the step or say what consumes its result.",
      anchors: [
        {
          source: "calendar.sigil",
          section: "logic",
          text:
            "Step two compares the\n    owner digest of the room with the digest kept from the previous refresh",
        },
      ],
    },
  ],
};

function proseOf(
  design: DesignInput,
  source: string,
  start: number,
  end: number,
): string | null {
  const text = design.sources.find((entry) => entry.path === source)?.text;
  if (text === undefined) return null;
  return new TextDecoder().decode(
    new TextEncoder().encode(text).slice(start, end),
  );
}

/** Resolve the fixture against one captured export and its prepared source requests. */
export function preflightSlottedFixture(
  design: DesignInput,
  prepared: readonly PreparedFacetRequest[],
): FixturePreflight {
  const expected = new Set(
    SLOTTED_FIXTURE.sources.map((source) => source.path),
  );
  const actual = new Set(design.sources.map((source) => source.path));
  const sourceDrift: string[] = [];
  for (const path of expected) {
    if (!actual.has(path)) sourceDrift.push(`missing required source: ${path}`);
  }
  for (const path of actual) {
    if (!expected.has(path)) sourceDrift.push(`unexpected source: ${path}`);
  }
  const canSchedule = sourceDrift.length === 0;
  for (const source of SLOTTED_FIXTURE.sources) {
    if (!actual.has(source.path)) continue;
    const imports = design.imports.filter((entry) =>
      entry.source === source.path && entry.status === "resolved"
    ).map((entry) => entry.provider).sort();
    const wanted = [...source.imports].sort();
    if (JSON.stringify(imports) !== JSON.stringify(wanted)) {
      sourceDrift.push(
        `imports changed for ${source.path}: expected ${
          wanted.join(", ") || "none"
        }; found ${imports.join(", ") || "none"}`,
      );
    }
  }

  const issues = SLOTTED_FIXTURE.issues.map((issue): IssuePreflight => {
    const facets: string[] = [];
    let reason: string | null = null;

    const fixedReferences = [
      issue.findingEvidence.subject === "cited-claim"
        ? null
        : issue.findingEvidence.subject,
      issue.findingEvidence.object,
    ].filter((id): id is string => id !== null);
    const fixedComponents: string[] = [];
    for (const id of fixedReferences) {
      const expectedType = id.includes(":tag:") ? "Tag" : "Component";
      const entity = design.entities.find((candidate) => candidate.id === id);
      if (!entity || !entity.valid || entity.type !== expectedType) {
        reason =
          `fixed ${expectedType} entity ${id} is missing, invalid, or has the wrong type`;
        break;
      }
      if (expectedType === "Component") fixedComponents.push(id);
    }

    for (const anchor of issue.anchors) {
      if (reason) break;
      const matches = design.units.filter((unit) =>
        unit.valid && unit.source === anchor.source &&
        unit.section === anchor.section &&
        proseOf(design, unit.source, unit.proseRange.start, unit.proseRange.end)
          ?.includes(anchor.text)
      );
      if (matches.length !== 1) {
        reason = matches.length === 0
          ? `missing ${anchor.source} ${anchor.section} anchor: ${anchor.text}`
          : `ambiguous ${anchor.source} ${anchor.section} anchor: ${anchor.text} (${matches.length} Facets)`;
        break;
      }
      const unit = matches[0];
      const expectedOwner = fixedComponents.find((id) =>
        design.entities.find((entity) => entity.id === id)?.source ===
          anchor.source
      );
      if (!expectedOwner || unit.owner !== expectedOwner) {
        reason = `anchor Facet owner drift for ${anchor.source}: expected ${
          expectedOwner ?? "no fixed component"
        }, found ${unit.owner}`;
        break;
      }
      const prose = proseOf(
        design,
        unit.source,
        unit.proseRange.start,
        unit.proseRange.end,
      );
      const requests = prepared.filter((request) =>
        request.binding.source === anchor.source
      );
      const rows = requests.flatMap((request) => request.rows).filter((row) =>
        row.facet === unit.id && row.source === anchor.source &&
        row.section === anchor.section && row.prose === prose
      );
      if (requests.length !== 1 || rows.length !== 1) {
        reason =
          `prepared request does not uniquely present ${anchor.source} anchor Facet`;
        break;
      }
      facets.push(unit.id);
    }
    if (!reason) {
      const scoringSource = issue.anchors[0].source;
      const scoringRequests = prepared.filter((request) =>
        request.binding.source === scoringSource
      );
      if (scoringRequests.length !== 1) {
        reason =
          `prepared ${scoringSource} scoring request is not unique for all anchor Facets`;
      } else {
        const scoringRequest = scoringRequests[0];
        for (let index = 0; index < issue.anchors.length; index++) {
          const anchor = issue.anchors[index];
          const unit = design.units.find((candidate) =>
            candidate.id === facets[index]
          );
          const prose = unit && proseOf(
            design,
            unit.source,
            unit.proseRange.start,
            unit.proseRange.end,
          );
          const rows = scoringRequest.rows.filter((row) =>
            row.facet === facets[index] && row.source === anchor.source &&
            row.section === anchor.section && row.prose === prose
          );
          if (!unit || rows.length !== 1) {
            reason =
              `${scoringSource} scoring request does not include all anchor Facets exactly once`;
            break;
          }
        }
      }
    }
    if (!reason && issue.requiresAbsentIdentityDisplayNameProvider) {
      const provider = design.units.some((unit) => {
        if (!unit.valid || unit.source !== "identity.sigil") return false;
        const prose = proseOf(
          design,
          unit.source,
          unit.proseRange.start,
          unit.proseRange.end,
        );
        return prose !== null && hasDisplayNameProvider(prose);
      });
      if (provider) reason = "Identity now describes a display-name provider";
    }
    return {
      ...issue,
      status: reason ? "drift" : "scorable",
      reason,
      facets: reason ? [] : facets,
    };
  });
  return { canSchedule, sourceDrift, issues };
}

function hasDisplayNameProvider(prose: string): boolean {
  const positiveProvider =
    /\b(?:provides?|supplies?|exposes?|returns?|offers?|keeps?|stores?|contains?|has|have)\b([^.!?]{0,100})\bdisplay[- ]name\b/gi;
  const clauses = prose
    .split(/[.!?]\s*|\b(?:but|however|although)\b/i)
    .map((clause) => clause.trim());
  for (const clause of clauses) {
    positiveProvider.lastIndex = 0;
    for (const match of clause.matchAll(positiveProvider)) {
      const verbStart = match.index!;
      const prefix = clause.slice(Math.max(0, verbStart - 48), verbStart);
      const between = match[1] ?? "";
      if (/\bnot\b(?!\s+only)|\b(?:never|cannot|can't|won't)\b/i.test(prefix)) {
        continue;
      }
      if (/\b(?:no|not|without|never|cannot|can't|won't)\b/i.test(between)) {
        continue;
      }
      return true;
    }
  }
  return false;
}
