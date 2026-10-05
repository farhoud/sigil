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
const request = {
  binding,
  rows: binding.facets.map((facet, index) => ({
    facet,
    handle: `f${index + 1}`,
  })),
};
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
  equal(
    checked.errors.includes(
      "incomplete presented Facet coverage: f2 (facet:rooms.sigil:1)",
    ),
    true,
    checked.errors.join("; "),
  );
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

  async function attempt(
    name: string,
    omitLast: boolean,
    childStatus: AgentRunResult["status"] = "completed",
    malformed = false,
  ) {
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
      timeoutMs: 10_000,
      interpret: async (preparationDir, evidenceDir) => {
        await Deno.mkdir(evidenceDir, { recursive: true });
        if (childStatus !== "completed") {
          return {
            status: childStatus,
            finalResponsePath: null,
            error: `child ${childStatus}`,
          } as AgentRunResult;
        }
        const brief = await Deno.readTextFile(`${preparationDir}/brief.md`);
        const handles = [...brief.matchAll(/^\[(f\d+)\] /gm)].map((line) =>
          line[1]
        );
        const rows = malformed
          ? ["not a claims row"]
          : handles.map((handle) => `(reading "${handle}" "no-commitment")`);
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
  const omitted = (partial.request?.rows as { facet: string; handle: string }[])
    .find((row) => row.facet === partial.validation?.missingFacets[0]);
  equal(
    partial.error?.includes(
      `incomplete presented Facet coverage: ${omitted?.handle} (${omitted?.facet})`,
    ),
    true,
    partial.error ?? "",
  );
  equal(
    partial.ingestResult !== null,
    true,
    "native ingest still accepted the partial artifact",
  );
  const timeout = await attempt("timeout", false, "timeout");
  equal(timeout.status, "interrupted");
  equal(timeout.failureStep, "child");
  equal(timeout.error, "child timeout");
  equal(timeout.state, null);
  const cancelled = await attempt("cancelled", false, "cancelled");
  equal(cancelled.status, "interrupted");
  equal(cancelled.failureStep, "child");
  const refused = await attempt("refused", false, "completed", true);
  equal(refused.status, "failed");
  equal(refused.failureStep, "ingest");
  equal(
    Boolean(
      refused.error && refused.error !== "ingest returned no structured result",
    ),
    true,
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
    timeoutMs: 1_000,
    interpret: () => {
      launched = true;
      throw new Error("should not launch");
    },
  });
  equal(checked.status, "failed");
  equal(checked.failureStep, "prepare");
  equal(launched, false);
});

Deno.test("native prepare timeout interrupts without blocking the batch", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-claims-timeout-" });
  const executable = `${scratch}/slow-claims.py`;
  const marker = `${scratch}/started`;
  await Deno.writeTextFile(
    executable,
    `#!/usr/bin/env python3
import pathlib, time
pathlib.Path(${JSON.stringify(marker)}).write_text('started')
print('prepare started', flush=True)
time.sleep(30)
`,
  );
  await Deno.chmod(executable, 0o755);
  let childLaunched = false;
  const startedAt = Date.now();
  try {
    const pending = runClaimsAttempt({
      executable,
      frontendPath: `${scratch}/frontend.json`,
      source: "identity.sigil",
      privateRoot: `${scratch}/private`,
      preparationDir: `${scratch}/prepared`,
      evidenceDir: `${scratch}/evidence`,
      timeoutMs: 500,
      interpret: () => {
        childLaunched = true;
        throw new Error("timed out prepare must not launch an agent");
      },
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        await Deno.stat(marker);
        break;
      } catch (cause) {
        if (!(cause instanceof Deno.errors.NotFound)) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    await Deno.stat(marker);
    const result = await pending;
    equal(result.status, "interrupted");
    equal(result.failureStep, "prepare");
    equal(result.error, "prepare timeout");
    equal(childLaunched, false);
    equal(Date.now() - startedAt < 5_000, true);
    equal(
      await Deno.readTextFile(`${scratch}/evidence/prepare.stdout.txt`),
      "prepare started\n",
    );
    await Deno.stat(`${scratch}/evidence/prepare.stderr.txt`);
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("the configured timeout covers preparation and interpretation together", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-total-timeout-" });
  const executable = `${scratch}/slow-prepare.py`;
  await Deno.writeTextFile(
    executable,
    `#!/usr/bin/env python3
import json, os, sys, time
args = sys.argv
out = args[args.index('--out') + 1]
time.sleep(0.25)
os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'binding.json'), 'w').write('{}')
open(os.path.join(out, 'request.json'), 'w').write('{"rows": []}')
print(json.dumps({'reusedUnits': 0, 'facets': 0}))
`,
  );
  await Deno.chmod(executable, 0o755);
  let childBudget = 0;
  const startedAt = Date.now();
  try {
    const result = await runClaimsAttempt({
      executable,
      frontendPath: `${scratch}/frontend.json`,
      source: "identity.sigil",
      privateRoot: `${scratch}/private`,
      preparationDir: `${scratch}/prepared`,
      evidenceDir: `${scratch}/evidence`,
      timeoutMs: 1_000,
      interpret: async (_prepared, _evidence, timeoutMs) => {
        childBudget = timeoutMs;
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
        return {
          status: "timeout",
          finalResponsePath: null,
          error: "child timeout",
        } as AgentRunResult;
      },
    });
    equal(result.status, "interrupted");
    equal(result.failureStep, "child");
    equal(childBudget > 0 && childBudget < 900, true);
    equal(Date.now() - startedAt < 2_500, true);
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});
