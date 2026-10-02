import { isAbsolute, relative, resolve, sep } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import type { AgentRunResult } from "./agents.ts";

type JsonObject = Record<string, unknown>;
export type ComputedState = "coherent" | "loose" | "disjoint";

export interface ClaimsEvidenceInput {
  readonly source: string;
  readonly privateRoot: string;
  readonly exitCode: number;
  readonly artifact: Uint8Array;
  readonly binding: JsonObject;
  readonly request: JsonObject;
  readonly prepare: JsonObject;
  readonly result: JsonObject;
  readonly report: JsonObject;
  readonly context: JsonObject;
}

export interface ClaimsValidation {
  readonly valid: boolean;
  readonly state: ComputedState | null;
  readonly coveredFacets: number;
  readonly missingFacets: readonly string[];
  readonly errors: readonly string[];
}

/** Validates native result identity and full first-reading coverage. */
export function validateClaimsEvidence(
  input: ClaimsEvidenceInput,
): ClaimsValidation {
  const errors: string[] = [];
  const binding = input.binding;
  const result = input.result;
  const report = input.report;
  const context = input.context;
  const identity = object(report.identity);
  const contextIdentity = object(context.identity);
  const requestBinding = object(input.request.binding);
  const state = result.state;
  const rows = array(input.request.rows);
  const facets = rows.map((row) => object(row)?.facet).filter((
    facet,
  ): facet is string => typeof facet === "string");
  const units = array(context.units).map(object).filter((
    unit,
  ): unit is JsonObject => unit !== null);
  const missingFacets = facets.filter((facet) => {
    const unit = units.find((candidate) => candidate.facet === facet);
    return !unit || unit.coverage === "uninterpreted" ||
      array(unit.asserted).length === 0;
  });

  if (input.prepare.reusedUnits !== 0) {
    errors.push("prepare reused prior interpretation units");
  }
  if (input.prepare.facets !== facets.length || facets.length !== rows.length) {
    errors.push("prepare facet count does not match request rows");
  }
  for (
    const key of [
      "source",
      "exportDigest",
      "guidanceFingerprint",
      "vocabularyGeneration",
    ]
  ) {
    if (binding[key] !== requestBinding?.[key]) {
      errors.push(`request binding ${key} mismatch`);
    }
  }
  if (
    binding.source !== input.source || result.source !== input.source ||
    report.source !== input.source || context.source !== input.source
  ) {
    errors.push("source identity mismatch");
  }
  const expectedExit = state === "disjoint"
    ? 1
    : state === "coherent" || state === "loose"
    ? 0
    : null;
  if (expectedExit === null || input.exitCode !== expectedExit) {
    errors.push("exit code and computed state mismatch");
  }
  if (report.state !== state || report.version !== result.version) {
    errors.push("report state or version mismatch");
  }
  if (result.findings !== array(report.findings).length) {
    errors.push("finding count mismatch");
  }
  if (
    result.guidanceFingerprint !== binding.guidanceFingerprint ||
    result.vocabularyGeneration !== binding.vocabularyGeneration
  ) {
    errors.push("ingest guidance identity mismatch");
  }
  for (
    const [name, observed] of [["report", identity], [
      "context",
      contextIdentity,
    ]] as const
  ) {
    if (
      !observed || observed.exportDigest !== binding.exportDigest ||
      observed.guidanceFingerprint !== binding.guidanceFingerprint ||
      observed.vocabularyGeneration !== binding.vocabularyGeneration
    ) {
      errors.push(`${name} binding identity mismatch`);
    }
  }
  const digest = hex(blake3(input.artifact));
  if (
    !identity || !sameArray(identity.interpretations, [digest]) ||
    !contextIdentity || !sameArray(contextIdentity.interpretations, [digest])
  ) {
    errors.push("interpretation digest mismatch");
  }
  if (
    !inside(input.privateRoot, result.report) ||
    !inside(input.privateRoot, result.judgmentContext)
  ) {
    errors.push("result path outside private root");
  }
  if (missingFacets.length) {
    errors.push(
      `incomplete presented Facet coverage: ${missingFacets.join(", ")}`,
    );
  }
  if (new Set(facets).size !== facets.length) {
    errors.push("duplicate presented Facet");
  }
  return {
    valid: errors.length === 0,
    state: errors.length === 0 ? state as ComputedState : null,
    coveredFacets: facets.length - missingFacets.length,
    missingFacets,
    errors,
  };
}

export interface ClaimsAttemptRequest {
  readonly executable: string;
  readonly frontendPath: string;
  readonly source: string;
  readonly privateRoot: string;
  readonly preparationDir: string;
  readonly evidenceDir: string;
  readonly interpret: (
    preparationDir: string,
    evidenceDir: string,
  ) => Promise<AgentRunResult>;
}

export interface ClaimsAttemptResult {
  readonly status: "valid" | "invalid" | "failed";
  readonly failureStep: "prepare" | "child" | "ingest" | "validation" | null;
  readonly error: string | null;
  readonly state: ComputedState | null;
  readonly validation: ClaimsValidation | null;
  readonly agent: AgentRunResult | null;
  readonly prepareResult: JsonObject | null;
  readonly ingestResult: JsonObject | null;
  readonly binding: JsonObject | null;
  readonly request: JsonObject | null;
  readonly report: JsonObject | null;
  readonly context: JsonObject | null;
}

/** Prepare, delegate exactly once, ingest exact child bytes, then validate. */
export async function runClaimsAttempt(
  input: ClaimsAttemptRequest,
): Promise<ClaimsAttemptResult> {
  let agent: AgentRunResult | null = null;
  let prepareResult: JsonObject | null = null;
  let ingestResult: JsonObject | null = null;
  let binding: JsonObject | null = null;
  let request: JsonObject | null = null;
  let report: JsonObject | null = null;
  let context: JsonObject | null = null;
  try {
    await Deno.mkdir(input.evidenceDir, { recursive: true });
    await Deno.mkdir(input.privateRoot, { recursive: true });
    for await (const _entry of Deno.readDir(input.privateRoot)) {
      return failure("prepare", "private claims root is not empty");
    }
    const prepared = await invoke(
      input.executable,
      [
        "prepare",
        "--frontend",
        input.frontendPath,
        "--source",
        input.source,
        "--out",
        input.preparationDir,
        "--root",
        input.privateRoot,
      ],
      input.evidenceDir,
      "prepare",
    );
    if (prepared.exitCode !== 0) {
      return failure("prepare", prepared.stderr || prepared.stdout);
    }
    prepareResult = object(JSON.parse(prepared.stdout));
    binding = object(
      JSON.parse(
        await Deno.readTextFile(`${input.preparationDir}/binding.json`),
      ),
    );
    request = object(
      JSON.parse(
        await Deno.readTextFile(`${input.preparationDir}/request.json`),
      ),
    );
    if (
      !prepareResult || !binding || !request || prepareResult.reusedUnits !== 0
    ) {
      return failure(
        "prepare",
        "invalid preparation or reused interpretation units",
      );
    }
    agent = await input.interpret(
      input.preparationDir,
      `${input.evidenceDir}/child`,
    );
    if (agent.status !== "completed" || !agent.finalResponsePath) {
      return failure("child", agent.error ?? `child ${agent.status}`);
    }
    const artifact = await Deno.readFile(agent.finalResponsePath);
    const ingested = await invoke(
      input.executable,
      [
        "ingest",
        "--frontend",
        input.frontendPath,
        "--binding",
        `${input.preparationDir}/binding.json`,
        "--claims",
        agent.finalResponsePath,
        "--root",
        input.privateRoot,
      ],
      input.evidenceDir,
      "ingest",
    );
    if (ingested.exitCode !== 0 && ingested.exitCode !== 1) {
      return failure("ingest", ingested.stderr || ingested.stdout);
    }
    try {
      ingestResult = object(JSON.parse(ingested.stdout));
    } catch {
      return failure("ingest", "ingest returned no structured result");
    }
    if (
      !ingestResult || !inside(input.privateRoot, ingestResult.report) ||
      !inside(input.privateRoot, ingestResult.judgmentContext)
    ) {
      return failure("validation", "native result paths escape private root");
    }
    report = object(
      JSON.parse(await Deno.readTextFile(ingestResult.report as string)),
    );
    context = object(
      JSON.parse(
        await Deno.readTextFile(ingestResult.judgmentContext as string),
      ),
    );
    if (!report || !context) {
      return failure("validation", "missing native report or context");
    }
    const validation = validateClaimsEvidence({
      source: input.source,
      privateRoot: input.privateRoot,
      exitCode: ingested.exitCode,
      artifact,
      binding,
      request,
      prepare: prepareResult,
      result: ingestResult,
      report,
      context,
    });
    return {
      status: validation.valid ? "valid" : "invalid",
      failureStep: validation.valid ? null : "validation",
      error: validation.valid ? null : validation.errors.join("; "),
      state: validation.state,
      validation,
      agent,
      prepareResult,
      ingestResult,
      binding,
      request,
      report,
      context,
    };
  } catch (cause) {
    return failure(
      agent ? "validation" : prepareResult ? "child" : "prepare",
      String(cause),
    );
  }

  function failure(
    step: Exclude<ClaimsAttemptResult["failureStep"], null>,
    message: string,
  ): ClaimsAttemptResult {
    return {
      status: "failed",
      failureStep: step,
      error: message,
      state: null,
      validation: null,
      agent,
      prepareResult,
      ingestResult,
      binding,
      request,
      report,
      context,
    };
  }
}

async function invoke(
  executable: string,
  args: string[],
  evidenceDir: string,
  name: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  await Promise.all([
    Deno.writeFile(`${evidenceDir}/${name}.stdout.txt`, output.stdout),
    Deno.writeFile(`${evidenceDir}/${name}.stderr.txt`, output.stderr),
  ]);
  return { exitCode: output.code, stdout, stderr };
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function sameArray(value: unknown, expected: readonly unknown[]): boolean {
  return Array.isArray(value) && value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]);
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function inside(root: string, path: unknown): boolean {
  if (typeof path !== "string" || !isAbsolute(path)) return false;
  const part = relative(resolve(root), resolve(path));
  return part !== "" && part !== ".." && !part.startsWith(`..${sep}`) &&
    !isAbsolute(part);
}
