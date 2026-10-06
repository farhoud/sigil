import {
  deepStrictEqual as assertEquals,
  match as assertMatch,
  ok as assert,
} from "node:assert/strict";
import {
  type DesignInput,
  InMemorySigilFileSystem,
  loadDesignInput,
} from "../../packages/core/src/mod.ts";
import {
  preflightSlottedFixture,
  type PreparedFacetRequest,
  SLOTTED_FIXTURE,
} from "./fixture.ts";

const sourcePaths = [
  "slotted.sigil",
  "identity.sigil",
  "rooms.sigil",
  "shared.sigil",
  "availability.sigil",
  "booking.sigil",
  "calendar.sigil",
];

async function snapshot(
  change?: (files: Record<string, string>) => void,
): Promise<{ design: DesignInput; prepared: PreparedFacetRequest[] }> {
  const files: Record<string, string> = {
    ".sigil/config.json": JSON.stringify({
      sigilVersion: "0.9.0",
      workspace: { name: "slotted" },
      files: { include: ["**/*.sigil"] },
    }),
  };
  for (const path of sourcePaths) {
    files[path] = await Deno.readTextFile(
      new URL(`../../examples/slotted/${path}`, import.meta.url),
    );
  }
  change?.(files);
  const { bundle } = await loadDesignInput(
    new InMemorySigilFileSystem(files),
    { startPath: "." },
  );
  assert(bundle, "Slotted export must be available");
  const sourceByModule = new Map(
    SLOTTED_FIXTURE.sources.map((source) => [
      source.path === "shared.sigil"
        ? "SharedKernel"
        : source.path.replace(/\.sigil$/, "").replace(/^./, (letter) =>
          letter.toUpperCase()),
      source.path,
    ]),
  );
  const prepared = SLOTTED_FIXTURE.sources.filter((source) =>
    files[source.path]
  )
    .map((source) => {
      const closure = new Set<string>();
      const visit = (path: string) => {
        if (closure.has(path)) return;
        closure.add(path);
        const dependency = SLOTTED_FIXTURE.sources.find((entry) =>
          entry.path === path
        );
        for (const imported of dependency?.imports ?? []) {
          const importedPath = sourceByModule.get(imported);
          if (importedPath) visit(importedPath);
        }
      };
      visit(source.path);
      return {
        binding: { source: source.path },
        rows: bundle.units.filter((unit) =>
          closure.has(unit.source) && unit.valid
        ).map((unit) => ({
          facet: unit.id,
          source: unit.source,
          section: unit.section,
          prose: bundle.sources.find((entry) => entry.path === unit.source)!
            .text.slice(unit.proseRange.start, unit.proseRange.end),
        })),
      };
    });
  return { design: bundle, prepared };
}

Deno.test("tool fixture resolves all seven Slotted sources and four issue IDs", async () => {
  const { design, prepared } = await snapshot();
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(SLOTTED_FIXTURE.version, 1);
  assertEquals(SLOTTED_FIXTURE.sources.map((s) => s.path), sourcePaths);
  assertEquals(result.canSchedule, true);
  assertEquals(result.sourceDrift, []);
  assertEquals(result.issues.length, 4);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
    "scorable",
  ]);
  assertEquals(new Set(result.issues.map((issue) => issue.id)).size, 4);
  assertEquals(result.issues.map((issue) => issue.findingEvidence), [
    {
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
    },
    {
      subject: "urn:sigil:component:booking.sigil:Booking",
      object: "urn:sigil:component:rooms.sigil:Rooms",
      eitherDirection: true,
    },
    {
      subject: "urn:sigil:component:calendar.sigil:Calendar",
      object:
        "urn:sigil:component:calendar.sigil:Calendar:tag:renter%20display%20name",
    },
    {
      subject: "cited-claim",
      object: "urn:sigil:component:calendar.sigil:Calendar",
    },
  ]);
  for (const issue of result.issues) {
    assertEquals(issue.facets.length, issue.anchors.length);
    assert(issue.facets.every((facet) => facet.startsWith("facet:")));
  }
  const ownership = result.issues.find((issue) =>
    issue.id === "booking-rooms-archived-mark-ownership"
  );
  assertEquals(ownership?.facets.length, 2);
  assertEquals(
    new Set(ownership?.anchors.map((anchor) => anchor.source)),
    new Set(["booking.sigil", "rooms.sigil"]),
  );
});

Deno.test("removed Booking exclusivity evidence withholds only ownership", async () => {
  const { design, prepared } = await snapshot((files) => {
    files["booking.sigil"] = files["booking.sigil"].replace(
      "Booking owns the archived room mark, and Booking is the only one that may set\n    or clear it, because only its archive workflow and unarchive workflow change\n    it.",
      "Booking calls Rooms to archive and unarchive a room.",
    );
  });
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(result.canSchedule, true);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "drift",
    "scorable",
    "scorable",
  ]);
  assertMatch(result.issues[1].reason ?? "", /booking\.sigil.*anchor/i);
});

Deno.test("anchor ownership drift withholds only the affected issue", async () => {
  const { design, prepared } = await snapshot();
  const ownershipAnchor = SLOTTED_FIXTURE.issues[1].anchors[0];
  const original = design.units.find((unit) =>
    unit.source === ownershipAnchor.source &&
    unit.section === ownershipAnchor.section &&
    design.sources.find((source) => source.path === unit.source)!.text.slice(
      unit.proseRange.start,
      unit.proseRange.end,
    ).includes(ownershipAnchor.text)
  );
  assert(original, "ownership anchor Facet must exist");
  const anotherValidOwner = design.entities.find((entity) =>
    entity.type === "Component" && entity.source === "calendar.sigil" &&
    entity.valid
  );
  assert(anotherValidOwner, "another valid component must exist");
  const changed = {
    ...design,
    units: design.units.map((unit) =>
      unit.id === original.id ? { ...unit, owner: anotherValidOwner.id } : unit
    ),
  };

  const result = preflightSlottedFixture(changed, prepared);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "drift",
    "scorable",
    "scorable",
  ]);
  assertMatch(result.issues[1].reason ?? "", /owner.*booking\.sigil/i);
});

Deno.test("fixed entity identity drift withholds only its issue", async () => {
  const { design, prepared } = await snapshot();
  const rangeChangeTag = design.entities.find((entity) =>
    entity.id === SLOTTED_FIXTURE.issues[0].findingEvidence.object
  );
  assert(rangeChangeTag, "fixed Range Change Tag must exist");
  const cases = [
    {
      label: "missing",
      entities: design.entities.filter((entity) =>
        entity.id !== rangeChangeTag.id
      ),
    },
    {
      label: "invalid",
      entities: design.entities.map((entity) =>
        entity.id === rangeChangeTag.id ? { ...entity, valid: false } : entity
      ),
    },
    {
      label: "wrong type",
      entities: design.entities.map((entity) =>
        entity.id === rangeChangeTag.id
          ? { ...entity, type: "Component" as const }
          : entity
      ),
    },
  ];
  for (const testCase of cases) {
    const result = preflightSlottedFixture(
      { ...design, entities: testCase.entities },
      prepared,
    );
    assertEquals(
      result.issues.map((issue) => issue.status),
      ["drift", "scorable", "scorable", "scorable"],
      `${testCase.label} fixed entity must withhold only contradiction`,
    );
    assertMatch(result.issues[0].reason ?? "", /fixed Tag entity/i);
  }
});

Deno.test("ownership issue requires every anchor Facet in Booking closure", async () => {
  const { design, prepared } = await snapshot();
  const resultBefore = preflightSlottedFixture(design, prepared);
  const issue = resultBefore.issues[1];
  const roomsAnchorIndex = issue.anchors.findIndex((anchor) =>
    anchor.source === "rooms.sigil"
  );
  const roomsFacet = issue.facets[roomsAnchorIndex];
  const bookingRequest = prepared.find((request) =>
    request.binding.source === "booking.sigil"
  );
  const roomsRequest = prepared.find((request) =>
    request.binding.source === "rooms.sigil"
  );
  assert(bookingRequest && roomsRequest, "source requests must exist");
  assert(
    bookingRequest.rows.some((row) => row.facet === roomsFacet),
    `Booking closure lacks ${roomsFacet}; rows include ${
      bookingRequest.rows
        .filter((row) => row.source === "rooms.sigil").map((row) => row.facet)
        .join(", ")
    }`,
  );
  assert(roomsRequest.rows.some((row) => row.facet === roomsFacet));
  const changedPrepared = prepared.map((request) =>
    request.binding.source === "booking.sigil"
      ? {
        ...request,
        rows: request.rows.filter((row) => row.facet !== roomsFacet),
      }
      : request
  );

  const result = preflightSlottedFixture(design, changedPrepared);
  assertEquals(result.issues.map((entry) => entry.status), [
    "scorable",
    "drift",
    "scorable",
    "scorable",
  ]);
  assertMatch(result.issues[1].reason ?? "", /Booking.*all.*anchor Facets/i);
});

Deno.test("Identity display-name provider withholds only Calendar obligation", async () => {
  const { design, prepared } = await snapshot((files) => {
    files["identity.sigil"] = files["identity.sigil"].replace(
      "    Identity provides resolution of the session from request headers outside",
      "    Identity keeps a display name for each user.\n\n    Identity provides resolution of the session from request headers outside",
    );
  });
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "drift",
    "scorable",
  ]);
  assertMatch(
    result.issues[2].reason ?? "",
    /Identity.*display.name provider/i,
  );
});

Deno.test("explicit Identity absence does not count as a display-name provider", async () => {
  const { design, prepared } = await snapshot((files) => {
    files["identity.sigil"] = files["identity.sigil"].replace(
      "    Identity provides resolution of the session from request headers outside",
      "    Identity does not provide a display name for each user.\n\n    Identity will not provide a display name for each user.\n\n    Identity won't provide a display name for each user.\n\n    Identity provides resolution of the session from request headers outside",
    );
  });
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(result.issues.map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
    "scorable",
  ]);
});

Deno.test("an anchor in two Facets is ambiguous", async () => {
  const { design, prepared } = await snapshot((files) => {
    const phrase =
      "Booking must not provide a range change of a pending request";
    files["booking.sigil"] = files["booking.sigil"].replace(
      "    Booking must not accept a booking request from the room owner of its room.",
      `    ${phrase}.\n\n    Booking must not accept a booking request from the room owner of its room.`,
    );
  });
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(result.issues[0].status, "drift");
  assertMatch(result.issues[0].reason ?? "", /ambiguous.*booking\.sigil/i);
  assertEquals(result.issues.slice(1).map((issue) => issue.status), [
    "scorable",
    "scorable",
    "scorable",
  ]);
});

Deno.test("a missing required source refuses the seven-source batch", async () => {
  const { design, prepared } = await snapshot((files) => {
    delete files["rooms.sigil"];
  });
  const result = preflightSlottedFixture(design, prepared);
  assertEquals(result.canSchedule, false);
  assertMatch(result.sourceDrift.join(" "), /missing.*rooms\.sigil/i);
});

Deno.test("import drift is reported while all seven sources can still run", async () => {
  const { design, prepared } = await snapshot();
  const changed = {
    ...design,
    imports: design.imports.filter((entry) =>
      !(entry.source === "calendar.sigil" && entry.provider === "Booking")
    ),
  };
  const result = preflightSlottedFixture(changed, prepared);
  assertEquals(result.canSchedule, true);
  assertMatch(
    result.sourceDrift.join(" "),
    /imports changed for calendar\.sigil/i,
  );
});
