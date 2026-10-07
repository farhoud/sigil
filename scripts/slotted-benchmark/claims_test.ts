import {
  deepStrictEqual as deepEqual,
  strictEqual as equal,
} from "node:assert/strict";
import { relative } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import {
  runClaimsAttempt,
  runClaimsPass,
  validateClaimsEvidence,
  validateLinkedEvidence,
} from "./claims.ts";
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
  sourceContent: "content",
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 2,
  facets: ["facet:booking.sigil:1", "facet:rooms.sigil:1"],
};
const request = { binding, rows: binding.facets.map((facet) => ({ facet })) };
const identity = {
  bindingDigest: "digest",
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
const prepare = { reusedUnits: 0, facets: 2, bindingDigest: "digest" };

Deno.test("matching Disjoint identity and every presented Facet are valid", () => {
  const checked = validateClaimsEvidence({
    source: "booking.sigil",
    privateStore: root,
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
    privateStore: root,
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
    privateStore: root,
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
    privateStore: root,
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
  const claims =
    new URL("../../packages/sigilc/target/debug/sigil-claims", import.meta.url)
      .pathname;
  const workspace = new URL("../../examples/slotted", import.meta.url).pathname;

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
      root: path(workspace),
      source: "identity.sigil",
      privateStore: path(`${dir}/private`),
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
        const request = JSON.parse(
          await Deno.readTextFile(`${preparationDir}/request.json`),
        );
        const rows = malformed
          ? ["not a claims row"]
          : (request.rows as { facet: string; context?: boolean }[])
            .filter((row) => !row.context).map((row) =>
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
    (full.request?.rows as { context?: boolean }[]).filter((row) =>
      !row.context
    ).length,
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

Deno.test("a nonempty private store stops the pass before prepare or child launch", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-nonempty-store-" });
  const privateStore = `${scratch}/private`;
  await Deno.mkdir(privateStore);
  await Deno.writeTextFile(`${privateStore}/old.txt`, "prior interpretation");
  let launched = false;
  const checked = await runClaimsPass({
    executable: "/missing/sigil-claims",
    root: "/missing/workspace",
    sources: ["identity.sigil"],
    privateStore,
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

const sevenSources = [
  "slotted.sigil",
  "identity.sigil",
  "rooms.sigil",
  "shared.sigil",
  "availability.sigil",
  "booking.sigil",
  "calendar.sigil",
];

/** A pass over the real fixture whose readers return no commitments. */
async function nativePass(failing?: string) {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-native-pass-" });
  const claims =
    new URL("../../packages/sigilc/target/debug/sigil-claims", import.meta.url)
      .pathname;
  const workspace = new URL("../../examples/slotted", import.meta.url).pathname;
  const interpreted: string[] = [];
  const pass = await runClaimsPass({
    executable: claims,
    root: workspace,
    sources: sevenSources,
    privateStore: `${scratch}/private`,
    preparationDir: `${scratch}/prepared`,
    evidenceDir: `${scratch}/evidence`,
    timeoutMs: 30_000,
    interpret: async (source, preparationDir, evidenceDir) => {
      interpreted.push(source);
      await Deno.mkdir(evidenceDir, { recursive: true });
      if (source === failing) {
        return {
          status: "failed",
          finalResponsePath: null,
          error: "reader failed",
        } as AgentRunResult;
      }
      const request = JSON.parse(
        await Deno.readTextFile(`${preparationDir}/request.json`),
      );
      const rows = (request.rows as { facet: string; context?: boolean }[])
        .filter((row) => !row.context).map((row) =>
          `(reading ${JSON.stringify(row.facet)} "no-commitment")`
        );
      const finalResponsePath = `${evidenceDir}/final-response.txt`;
      await Deno.writeTextFile(finalResponsePath, `${rows.join("\n")}\n`);
      return {
        status: "completed",
        finalResponsePath,
        error: null,
      } as AgentRunResult;
    },
  });
  return { scratch, pass, interpreted };
}

Deno.test("a pass reads every source into one store, then one linked check validates", async () => {
  const { scratch, pass, interpreted } = await nativePass();
  try {
    deepEqual(interpreted, sevenSources);
    equal(pass.status, "valid", pass.error ?? "");
    equal(pass.sources.every((entry) => entry.status === "valid"), true);
    equal(pass.linked?.validation?.valid, true);
    equal(pass.state === "loose" || pass.state === "coherent", true);
    const unread = pass.linked?.report?.unread as unknown[];
    equal(unread.length, 0);
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

Deno.test("a pass whose reader fails still links what was read and reports incomplete", async () => {
  const { scratch, pass, interpreted } = await nativePass("rooms.sigil");
  try {
    deepEqual(interpreted, sevenSources);
    equal(pass.status, "failed");
    equal(pass.state, "incomplete");
    equal(pass.linked?.exitCode, 1);
    equal(pass.linked?.validation?.valid, true);
    const unread = pass.linked?.report?.unread as { source: string }[];
    equal(unread.some((entry) => entry.source === "rooms.sigil"), true);
    equal(
      pass.sources.filter((entry) => entry.status === "valid").length,
      6,
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});

const linkedIdentity = {
  bindingDigest: "merged",
  guidanceFingerprint: "guidance",
  vocabularyGeneration: 2,
  interpretations: ["aaa", "bbb"],
};
function linkedInput(state: string, exitCode: number, unread: unknown[] = []) {
  return {
    privateStore: root,
    exitCode,
    workspaceDigest: "workspace",
    guidanceFingerprint: "guidance",
    vocabularyGeneration: 2,
    sources: [{ source: "booking.sigil", bindingDigest: "digest" }],
    everySourceRead: unread.length === 0,
    memoKeys: ["aaa", "bbb"],
    result: {
      version: 4,
      scope: "workspace",
      state,
      findings: 0,
      report: `${root}/claims/workspace.linked.json`,
      judgmentContext: `${root}/claims/workspace.linked.context.json`,
      workspaceDigest: "workspace",
      guidanceFingerprint: "guidance",
      vocabularyGeneration: 2,
    },
    report: {
      version: 4,
      source: "workspace",
      state,
      identity: linkedIdentity,
      findings: [],
      unread,
      unresolvedImports: [],
      linked: {
        workspaceDigest: "workspace",
        sources: [{ source: "booking.sigil", bindingDigest: "digest" }],
      },
    },
    context: { source: "workspace", identity: linkedIdentity, units: [] },
  };
}

Deno.test("a linked report exits 1 exactly when disjoint or incomplete", () => {
  const loose = validateLinkedEvidence(linkedInput("loose", 0));
  equal(loose.valid, true, loose.errors.join("; "));
  equal(loose.state, "loose");
  const looseFails = validateLinkedEvidence(linkedInput("loose", 1));
  equal(looseFails.valid, false);
  equal(looseFails.state, null);
  equal(
    looseFails.errors.some((error) => error.includes("exit code")),
    true,
  );
  const disjoint = validateLinkedEvidence(linkedInput("disjoint", 1));
  equal(disjoint.valid, true, disjoint.errors.join("; "));
  const incomplete = validateLinkedEvidence(
    linkedInput("incomplete", 1, [{ source: "rooms.sigil", facets: ["f"] }]),
  );
  equal(incomplete.valid, true, incomplete.errors.join("; "));
  equal(incomplete.state, "incomplete");
  equal(validateLinkedEvidence(linkedInput("incomplete", 0)).valid, false);
});

Deno.test("unread units reported as loose, or a stale workspace digest, are rejected", () => {
  const unread = linkedInput("loose", 0, [{ source: "rooms.sigil" }]);
  equal(validateLinkedEvidence(unread).valid, false);
  const stale = linkedInput("loose", 0);
  const checked = validateLinkedEvidence({
    ...stale,
    workspaceDigest: "other",
  });
  equal(checked.valid, false);
  equal(
    checked.errors.some((error) => error.includes("workspace digest")),
    true,
  );
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
      root: `${scratch}/workspace`,
      source: "identity.sigil",
      privateStore: `${scratch}/private`,
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
      root: `${scratch}/workspace`,
      source: "identity.sigil",
      privateStore: `${scratch}/private`,
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
