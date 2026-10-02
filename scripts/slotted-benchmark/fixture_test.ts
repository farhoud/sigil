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
  const prepared = sourcePaths.filter((path) => files[path]).map((path) => ({
    binding: { source: path },
    rows: bundle.units.filter((unit) => unit.source === path && unit.valid).map(
      (unit) => ({
        facet: unit.id,
        source: unit.source,
        section: unit.section,
        prose: bundle.sources.find((source) => source.path === path)!.text
          .slice(
            unit.proseRange.start,
            unit.proseRange.end,
          ),
      }),
    ),
  }));
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

Deno.test("Identity display-name provider withholds only Calendar obligation", async () => {
  const { design, prepared } = await snapshot((files) => {
    files["identity.sigil"] = files["identity.sigil"].replace(
      "    Identity provides resolution of the session from request headers outside",
      "    Identity provides the renter display name of each user account to Calendar.\n\n    Identity provides resolution of the session from request headers outside",
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
