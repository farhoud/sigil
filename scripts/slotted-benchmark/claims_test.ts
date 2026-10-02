import {
  deepStrictEqual as deepEqual,
  strictEqual as equal,
} from "node:assert/strict";
import { relative } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { runClaimsAttempt, validateClaimsEvidence } from "./claims.ts";
import type { AgentRunResult } from "./agents.ts";

const artifact = new TextEncoder().encode(
  '(reading "facet:rooms.sigil:1" "no-commitment")\n',
);
const digest = Array.from(blake3(artifact)).map((byte) =>
  byte.toString(16).padStart(2, "0")
).join("");
const root = "/tmp/slotted-claims-test/private";
const binding = {
  source: "booking.sigil",
  exportDigest: "export",
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 2,
  facets: ["facet:booking.sigil:1", "facet:rooms.sigil:1"],
};
const request = { binding, rows: binding.facets.map((facet) => ({ facet })) };
const identity = {
  exportDigest: "export",
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 2,
  interpretations: [digest],
};
const result = {
  version: 2,
  source: "booking.sigil",
  state: "disjoint",
  findings: 1,
  report: `${root}/.sigil/claims/booking.report.json`,
  judgmentContext: `${root}/.sigil/claims/booking.context.json`,
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 2,
};
const report = {
  version: 2,
  source: "booking.sigil",
  state: "disjoint",
  identity,
  findings: [{}],
};
const context = {
  source: "booking.sigil",
  identity,
  units: binding.facets.map((facet) => ({
    facet,
    coverage: "read-without-commitment",
    asserted: [{ claim: "c", satisfiesUnit: true }],
  })),
};
const prepare = { reusedUnits: 0, facets: 2 };

Deno.test("matching Disjoint identity and every presented Facet are valid", () => {
  const checked = validateClaimsEvidence({
    source: "booking.sigil",
    privateRoot: root,
    exitCode: 1,
    artifact,
    binding,
    request,
    prepare,
    result,
    report,
    context,
  });
  equal(checked.valid, true);
  equal(checked.state, "disjoint");
  deepEqual(checked.missingFacets, []);
});

Deno.test("omitted contextual Facet withholds state despite native ingest", () => {
  const checked = validateClaimsEvidence({
    source: "booking.sigil",
    privateRoot: root,
    exitCode: 1,
    artifact,
    binding,
    request,
    prepare,
    result,
    report,
    context: { ...context, units: context.units.slice(0, 1) },
  });
  equal(checked.valid, false);
  equal(checked.state, null);
  deepEqual(checked.missingFacets, ["facet:rooms.sigil:1"]);
});

Deno.test("wrong artifact digest and path outside private root are rejected", () => {
  const checked = validateClaimsEvidence({
    source: "booking.sigil",
    privateRoot: root,
    exitCode: 1,
    artifact: new TextEncoder().encode("different"),
    binding,
    request,
    prepare,
    result: { ...result, report: "/tmp/other.report.json" },
    report,
    context,
  });
  equal(checked.valid, false);
  equal(checked.state, null);
  equal(
    checked.errors.some((error) => error.includes("interpretation digest")),
    true,
  );
  equal(checked.errors.some((error) => error.includes("private root")), true);
});

Deno.test("a reading row counts as Facet coverage", () => {
  const checked = validateClaimsEvidence({
    source: "booking.sigil",
    privateRoot: root,
    exitCode: 1,
    artifact,
    binding,
    request,
    prepare,
    result,
    report,
    context,
  });
  equal(checked.coveredFacets, 2);
});

Deno.test("native prepare and ingest retain a valid full reading and reject an omitted Facet", async () => {
  const scratch = await Deno.makeTempDir({
    prefix: "slotted-native-claims-test-",
  });
  const cli = new URL("../../build/sigil", import.meta.url).pathname;
  const claims =
    new URL("../../packages/sigilc/target/debug/sigil-claims", import.meta.url)
      .pathname;
  const workspace = new URL("../../examples/slotted", import.meta.url).pathname;
  const exported = await new Deno.Command(cli, {
    args: [
      "export",
      "design",
      workspace,
      "--root",
      workspace,
      "--format",
      "json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(exported.code, 0, new TextDecoder().decode(exported.stderr));
  const frontendPath = `${scratch}/frontend.json`;
  await Deno.writeFile(frontendPath, exported.stdout);

  async function attempt(name: string, omitLast: boolean) {
    const dir = `${scratch}/${name}`;
    const path = (value: string) =>
      name === "full" ? relative(Deno.cwd(), value) : value;
    return await runClaimsAttempt({
      executable: claims,
      frontendPath: path(frontendPath),
      source: "identity.sigil",
      privateRoot: path(`${dir}/private`),
      preparationDir: path(`${dir}/prepared`),
      evidenceDir: path(`${dir}/evidence`),
      interpret: async (preparationDir, evidenceDir) => {
        await Deno.mkdir(evidenceDir, { recursive: true });
        const request = JSON.parse(
          await Deno.readTextFile(`${preparationDir}/request.json`),
        );
        const rows = (request.rows as { facet: string }[]).map((row) =>
          `(reading ${JSON.stringify(row.facet)} "no-commitment")`
        );
        if (omitLast) rows.pop();
        const finalResponsePath = `${evidenceDir}/final-response.txt`;
        await Deno.writeTextFile(finalResponsePath, `${rows.join("\n")}\n`);
        return {
          status: "completed",
          finalResponsePath,
          error: null,
        } as AgentRunResult;
      },
    });
  }
  const full = await attempt("full", false);
  equal(full.status, "valid", full.error ?? "");
  equal(
    full.validation?.coveredFacets,
    (full.request?.rows as unknown[]).length,
  );
  const partial = await attempt("partial", true);
  equal(partial.status, "invalid", partial.error ?? "");
  equal(partial.state, null);
  equal(partial.validation?.missingFacets.length, 1);
  equal(
    partial.ingestResult !== null,
    true,
    "native ingest still accepted the partial artifact",
  );
});

Deno.test("a nonempty private root stops before prepare or child launch", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-nonempty-root-" });
  const privateRoot = `${scratch}/private`;
  await Deno.mkdir(privateRoot);
  await Deno.writeTextFile(`${privateRoot}/old.txt`, "prior interpretation");
  let launched = false;
  const checked = await runClaimsAttempt({
    executable: "/missing/sigil-claims",
    frontendPath: "/missing/export.json",
    source: "identity.sigil",
    privateRoot,
    preparationDir: `${scratch}/prepared`,
    evidenceDir: `${scratch}/evidence`,
    interpret: () => {
      launched = true;
      throw new Error("should not launch");
    },
  });
  equal(checked.status, "failed");
  equal(checked.failureStep, "prepare");
  equal(launched, false);
});
