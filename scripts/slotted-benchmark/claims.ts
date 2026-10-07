import { isAbsolute, relative, resolve, sep } from "node:path";
import { blake3 } from "@noble/hashes/blake3.js";
import { captureStream, settleWithin, signalOwnedProcess } from "./process.ts";
import type { AgentRunResult } from "./agents.ts";

type JsonObject = Record<string, unknown>;
export type ComputedState = "coherent" | "loose" | "disjoint" | "incomplete";
/** A source's own ingest never reports `incomplete`; only the linked check does. */
const LINKED_REPORT_VERSION = 4;

export interface ClaimsEvidenceInput {
  readonly source: string;
  readonly privateStore: string;
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
  // Dependency interfaces ride along as context rows; only the rest are read.
  const rows = array(input.request.rows).filter((row) =>
    object(row)?.context !== true
  );
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
      "sourceContent",
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
  // Ingest stays local: it never reports `incomplete`.
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
      !observed || observed.bindingDigest !== input.prepare.bindingDigest ||
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
    !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
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
  /** The workspace root `sigil-claims` reads. */
  readonly root: string;
  readonly source: string;
  /**
   * The pass's private store. It starts empty, and a source's own units are
   * never read from an earlier attempt: they are read here for the first time.
   */
  readonly privateStore: string;
  readonly preparationDir: string;
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly interpret: (
    preparationDir: string,
    evidenceDir: string,
    timeoutMs: number,
  ) => Promise<AgentRunResult>;
}

export interface ClaimsAttemptResult {
  readonly status: "valid" | "invalid" | "failed" | "interrupted";
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

/** Prepare one source, delegate exactly once, ingest exact child bytes, then validate. */
export async function runClaimsAttempt(
  input: ClaimsAttemptRequest,
): Promise<ClaimsAttemptResult> {
  const root = resolve(input.root);
  const privateStore = resolve(input.privateStore);
  const preparationDir = resolve(input.preparationDir);
  const evidenceDir = resolve(input.evidenceDir);
  const deadline = Date.now() + input.timeoutMs;
  const remainingMs = () => deadline - Date.now();
  let agent: AgentRunResult | null = null;
  let prepareResult: JsonObject | null = null;
  let ingestResult: JsonObject | null = null;
  let binding: JsonObject | null = null;
  let request: JsonObject | null = null;
  let report: JsonObject | null = null;
  let context: JsonObject | null = null;
  try {
    if (remainingMs() <= 0) {
      return failure("prepare", "attempt timeout", "interrupted");
    }
    await Deno.mkdir(evidenceDir, { recursive: true });
    await Deno.mkdir(privateStore, { recursive: true });
    const prepared = await invoke(
      input.executable,
      [
        "prepare",
        "--source",
        input.source,
        "--out",
        preparationDir,
        "--root",
        root,
        "--store",
        privateStore,
      ],
      evidenceDir,
      "prepare",
      remainingMs(),
      input.signal,
    );
    if (prepared.stopReason) {
      return failure(
        "prepare",
        `prepare ${prepared.stopReason}`,
        "interrupted",
      );
    }
    if (prepared.exitCode !== 0) {
      return failure("prepare", prepared.stderr || prepared.stdout);
    }
    prepareResult = object(JSON.parse(prepared.stdout));
    binding = object(
      JSON.parse(
        await Deno.readTextFile(`${preparationDir}/binding.json`),
      ),
    );
    request = object(
      JSON.parse(
        await Deno.readTextFile(`${preparationDir}/request.json`),
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
    if (remainingMs() <= 0) {
      return failure("child", "attempt timeout", "interrupted");
    }
    agent = await input.interpret(
      preparationDir,
      `${evidenceDir}/child`,
      remainingMs(),
    );
    if (agent.status !== "completed" || !agent.finalResponsePath) {
      return failure(
        "child",
        agent.error ?? `child ${agent.status}`,
        agent.status === "timeout" || agent.status === "cancelled"
          ? "interrupted"
          : "failed",
      );
    }
    const artifact = await Deno.readFile(agent.finalResponsePath);
    if (remainingMs() <= 0) {
      return failure("ingest", "attempt timeout", "interrupted");
    }
    const ingested = await invoke(
      input.executable,
      [
        "ingest",
        "--binding",
        `${preparationDir}/binding.json`,
        "--claims",
        agent.finalResponsePath,
        "--root",
        root,
        "--store",
        privateStore,
      ],
      evidenceDir,
      "ingest",
      remainingMs(),
      input.signal,
    );
    if (ingested.stopReason) {
      return failure("ingest", `ingest ${ingested.stopReason}`, "interrupted");
    }
    if (ingested.exitCode !== 0 && ingested.exitCode !== 1) {
      return failure("ingest", ingested.stderr || ingested.stdout);
    }
    try {
      ingestResult = object(JSON.parse(ingested.stdout));
    } catch {
      return failure(
        "ingest",
        ingested.stderr.trim() || "ingest returned no structured result",
      );
    }
    if (
      !ingestResult || !inside(privateStore, ingestResult.report) ||
      !inside(privateStore, ingestResult.judgmentContext)
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
      privateStore,
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
    status: "failed" | "interrupted" = "failed",
  ): ClaimsAttemptResult {
    return {
      status,
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

export interface LinkedEvidenceInput {
  readonly privateStore: string;
  readonly exitCode: number;
  /** The workspace digest every source's prepare reported, if any ran. */
  readonly workspaceDigest: string | null;
  readonly guidanceFingerprint: string | null;
  readonly vocabularyGeneration: unknown;
  /** Each source that was prepared, with its binding digest. */
  readonly sources: readonly {
    readonly source: string;
    readonly bindingDigest: unknown;
  }[];
  /** True when every source was read and validated on its own. */
  readonly everySourceRead: boolean;
  /** The memo keys present in the private store when the check ran. */
  readonly memoKeys: readonly string[];
  readonly result: JsonObject;
  readonly report: JsonObject;
  readonly context: JsonObject;
}

export interface LinkedValidation {
  readonly valid: boolean;
  readonly state: ComputedState | null;
  readonly errors: readonly string[];
}

/** Validates the linked check's identity, exit code and completeness. */
export function validateLinkedEvidence(
  input: LinkedEvidenceInput,
): LinkedValidation {
  const errors: string[] = [];
  const { result, report, context } = input;
  const state = result.state;
  const identity = object(report.identity);
  const contextIdentity = object(context.identity);
  const linked = object(report.linked);
  const unread = array(report.unread);
  const unresolved = array(report.unresolvedImports);
  const expectedExit = state === "disjoint" || state === "incomplete"
    ? 1
    : state === "coherent" || state === "loose"
    ? 0
    : null;
  if (expectedExit === null || input.exitCode !== expectedExit) {
    errors.push("exit code and linked state mismatch");
  }
  if (report.state !== state || report.version !== result.version) {
    errors.push("linked report state or version mismatch");
  }
  if (report.version !== LINKED_REPORT_VERSION) {
    errors.push(`linked report version is not ${LINKED_REPORT_VERSION}`);
  }
  if (
    result.scope !== "workspace" || report.source !== "workspace" ||
    context.source !== "workspace"
  ) {
    errors.push("linked scope is not the workspace");
  }
  if (result.findings !== array(report.findings).length) {
    errors.push("finding count mismatch");
  }
  if (
    result.guidanceFingerprint !== input.guidanceFingerprint ||
    result.vocabularyGeneration !== input.vocabularyGeneration
  ) {
    errors.push("linked guidance identity mismatch");
  }
  for (
    const [name, observed] of [["report", identity], [
      "context",
      contextIdentity,
    ]] as const
  ) {
    if (
      !observed ||
      observed.guidanceFingerprint !== input.guidanceFingerprint ||
      observed.vocabularyGeneration !== input.vocabularyGeneration
    ) {
      errors.push(`linked ${name} identity mismatch`);
    }
  }
  if (
    input.workspaceDigest !== null &&
    (result.workspaceDigest !== input.workspaceDigest ||
      linked?.workspaceDigest !== input.workspaceDigest)
  ) {
    errors.push("linked workspace digest mismatch");
  }
  const linkedSources = array(linked?.sources).map(object);
  for (const source of input.sources) {
    const entry = linkedSources.find((candidate) =>
      candidate?.source === source.source
    );
    if (!entry || entry.bindingDigest !== source.bindingDigest) {
      errors.push(`linked binding digest mismatch for ${source.source}`);
    }
  }
  const keys = array(identity?.interpretations);
  const present = new Set(input.memoKeys);
  if (
    !keys.every((key) => typeof key === "string" && present.has(key)) ||
    [...keys].sort().join("\n") !== keys.join("\n")
  ) {
    errors.push("linked interpretations are not stored sorted memo keys");
  }
  if (
    sameArray(contextIdentity?.interpretations, keys) === false
  ) {
    errors.push("linked context interpretations differ from the report");
  }
  if (input.everySourceRead && keys.length !== input.memoKeys.length) {
    errors.push("linked check did not link every stored reading");
  }
  const incomplete = unread.length > 0 || unresolved.length > 0;
  if (incomplete && state !== "disjoint" && state !== "incomplete") {
    errors.push(`unread units or unresolved imports reported as ${state}`);
  }
  if (state === "incomplete" && !incomplete) {
    errors.push("incomplete state with nothing unread or unresolved");
  }
  if (input.everySourceRead && incomplete) {
    errors.push("units unread although every source was read");
  }
  if (
    !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
  ) {
    errors.push("result path outside private root");
  }
  return {
    valid: errors.length === 0,
    state: errors.length === 0 ? state as ComputedState : null,
    errors,
  };
}

export interface ClaimsPassRequest {
  readonly executable: string;
  /** The workspace root `sigil-claims` reads. */
  readonly root: string;
  /** Every source the pass reads, in order. */
  readonly sources: readonly string[];
  /** An empty directory shared by every source of the pass. */
  readonly privateStore: string;
  /** Each source is prepared under `<preparationDir>/<name>`. */
  readonly preparationDir: string;
  /** Each source's evidence is kept under `<evidenceDir>/<name>`; the check's under `check`. */
  readonly evidenceDir: string;
  /** The budget of each source's attempt, and of the check. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly interpret: (
    source: string,
    preparationDir: string,
    evidenceDir: string,
    timeoutMs: number,
  ) => Promise<AgentRunResult>;
}

export interface LinkedCheckResult {
  readonly exitCode: number | null;
  readonly result: JsonObject | null;
  readonly report: JsonObject | null;
  readonly context: JsonObject | null;
  readonly validation: LinkedValidation | null;
  readonly error: string | null;
}

export interface ClaimsPassResult {
  readonly status: "valid" | "invalid" | "failed" | "interrupted";
  readonly failureStep:
    | "prepare"
    | "child"
    | "ingest"
    | "check"
    | "validation"
    | null;
  readonly error: string | null;
  /** The linked state, when the check ran and its report validated. */
  readonly state: ComputedState | null;
  readonly sources: readonly (ClaimsAttemptResult & {
    readonly source: string;
  })[];
  readonly linked: LinkedCheckResult | null;
}

/** The directory name a source's files take inside a pass. */
export function sourceName(source: string): string {
  return source.replace(/\.sigil$/, "").replaceAll(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Read every source into one private store, then run one linked check.
 *
 * Each source gets its own prepare, fresh reader, ingest and budget. A source
 * that fails is kept and the others still run, so the check reports the
 * workspace as incomplete and names what was not read.
 */
export async function runClaimsPass(
  input: ClaimsPassRequest,
): Promise<ClaimsPassResult> {
  const root = resolve(input.root);
  const privateStore = resolve(input.privateStore);
  const preparationDir = resolve(input.preparationDir);
  const evidenceDir = resolve(input.evidenceDir);
  const sources: (ClaimsAttemptResult & { source: string })[] = [];
  const passFailure = (
    step: Exclude<ClaimsPassResult["failureStep"], null>,
    message: string,
    status: "failed" | "interrupted" | "invalid" = "failed",
    linked: LinkedCheckResult | null = null,
  ): ClaimsPassResult => ({
    status,
    failureStep: step,
    error: message,
    state: null,
    sources,
    linked,
  });
  try {
    await Deno.mkdir(privateStore, { recursive: true });
    for await (const _entry of Deno.readDir(privateStore)) {
      return passFailure("prepare", "private claims store is not empty");
    }
    for (const source of input.sources) {
      if (input.signal?.aborted) {
        return passFailure("child", "pass cancelled", "interrupted");
      }
      const name = sourceName(source);
      const attempt = await runClaimsAttempt({
        executable: input.executable,
        root,
        source,
        privateStore,
        preparationDir: `${preparationDir}/${name}`,
        evidenceDir: `${evidenceDir}/${name}`,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
        interpret: (prepared, evidence, timeoutMs) =>
          input.interpret(source, prepared, evidence, timeoutMs),
      });
      sources.push({ ...attempt, source });
    }
    if (input.signal?.aborted) {
      return passFailure("check", "pass cancelled", "interrupted");
    }

    const linked = await runLinkedCheck({
      executable: input.executable,
      root,
      privateStore,
      evidenceDir: `${evidenceDir}/check`,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      sources,
    });
    const unread = sources.filter((entry) => entry.status !== "valid");
    const sourceError = unread.map((entry) =>
      `${entry.source}: ${entry.error ?? entry.status}`
    ).join("; ");
    if (linked.error || !linked.validation) {
      return passFailure(
        "check",
        [linked.error, sourceError].filter(Boolean).join("; "),
        linked.error?.includes("interrupted") ? "interrupted" : "failed",
        linked,
      );
    }
    if (!linked.validation.valid) {
      return {
        ...passFailure(
          "validation",
          linked.validation.errors.join("; "),
          "invalid",
          linked,
        ),
        state: null,
      };
    }
    const first = unread[0];
    return {
      status: unread.length === 0 ? "valid" : "failed",
      failureStep: first?.failureStep ?? null,
      error: unread.length === 0 ? null : sourceError,
      state: linked.validation.state,
      sources,
      linked,
    };
  } catch (cause) {
    return passFailure("check", String(cause));
  }
}

async function runLinkedCheck(input: {
  readonly executable: string;
  readonly root: string;
  readonly privateStore: string;
  readonly evidenceDir: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly sources: readonly (ClaimsAttemptResult & {
    readonly source: string;
  })[];
}): Promise<LinkedCheckResult> {
  const none = (error: string): LinkedCheckResult => ({
    exitCode: null,
    result: null,
    report: null,
    context: null,
    validation: null,
    error,
  });
  await Deno.mkdir(input.evidenceDir, { recursive: true });
  const checked = await invoke(
    input.executable,
    ["check", "--root", input.root, "--store", input.privateStore],
    input.evidenceDir,
    "check",
    input.timeoutMs,
    input.signal,
  );
  if (checked.stopReason) {
    return none(`check ${checked.stopReason}: interrupted`);
  }
  if (checked.exitCode !== 0 && checked.exitCode !== 1) {
    return none(checked.stderr || checked.stdout || "check failed");
  }
  let result: JsonObject | null;
  try {
    result = object(JSON.parse(checked.stdout));
  } catch {
    return none(checked.stderr.trim() || "check returned no structured result");
  }
  if (
    !result || !inside(input.privateStore, result.report) ||
    !inside(input.privateStore, result.judgmentContext)
  ) {
    return none("check result paths escape private root");
  }
  const report = object(
    JSON.parse(await Deno.readTextFile(result.report as string)),
  );
  const context = object(
    JSON.parse(await Deno.readTextFile(result.judgmentContext as string)),
  );
  if (!report || !context) return none("missing linked report or context");
  const memoKeys: string[] = [];
  try {
    for await (
      const entry of Deno.readDir(
        `${input.privateStore}/claims/interpretations`,
      )
    ) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        memoKeys.push(entry.name.slice(0, -".json".length));
      }
    }
  } catch (cause) {
    if (!(cause instanceof Deno.errors.NotFound)) throw cause;
  }
  const prepared = input.sources.filter((entry) =>
    entry.prepareResult && entry.binding
  );
  const digests = new Set(
    prepared.map((entry) => entry.prepareResult!.workspaceDigest),
  );
  const bindings = prepared.map((entry) => entry.binding!);
  const validation = validateLinkedEvidence({
    privateStore: input.privateStore,
    exitCode: checked.exitCode,
    workspaceDigest: digests.size === 1 ? [...digests][0] as string : null,
    guidanceFingerprint: bindings.length
      ? bindings[0].guidanceFingerprint as string
      : result.guidanceFingerprint as string,
    vocabularyGeneration: bindings.length
      ? bindings[0].vocabularyGeneration
      : result.vocabularyGeneration,
    sources: prepared.map((entry) => ({
      source: entry.source,
      bindingDigest: entry.prepareResult!.bindingDigest,
    })),
    everySourceRead: input.sources.every((entry) => entry.status === "valid"),
    memoKeys: memoKeys.sort(),
    result,
    report,
    context,
  });
  if (digests.size > 1) {
    return {
      exitCode: checked.exitCode,
      result,
      report,
      context,
      validation: {
        ...validation,
        valid: false,
        state: null,
        errors: [...validation.errors, "workspace changed during the pass"],
      },
      error: null,
    };
  }
  return {
    exitCode: checked.exitCode,
    result,
    report,
    context,
    validation,
    error: null,
  };
}

async function invoke(
  executable: string,
  args: string[],
  evidenceDir: string,
  name: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stopReason: "timeout" | "cancelled" | null;
}> {
  const child = new Deno.Command(executable, {
    args,
    stdout: "piped",
    stderr: "piped",
    detached: Deno.build.os !== "windows",
  }).spawn();
  const stdoutCapture = captureStream(child.stdout);
  const stderrCapture = captureStream(child.stderr);
  const outputDone = Promise.all([
    stdoutCapture.done,
    stderrCapture.done,
  ]);
  const processState: { status: Deno.CommandStatus | null } = { status: null };
  const processDone = child.status.then((status) => {
    processState.status = status;
  });
  let stopReason: "timeout" | "cancelled" | null = null;
  let resolveStop!: (reason: "timeout" | "cancelled") => void;
  const stopped = new Promise<"timeout" | "cancelled">((resolve) => {
    resolveStop = resolve;
  });
  const stop = (reason: "timeout" | "cancelled") => {
    if (stopReason !== null) return;
    stopReason = reason;
    resolveStop(reason);
    void signalOwnedProcess(child, "SIGTERM");
  };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const onAbort = () => stop("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) stop("cancelled");

  try {
    const first = await Promise.race([
      processDone.then(() => ({ processExited: true as const })),
      stopped.then((reason) => ({ reason })),
    ]);
    if ("reason" in first) {
      const exited = await settleWithin(processDone, 2_250);
      if (!exited) {
        await signalOwnedProcess(child, "SIGKILL");
        await settleWithin(processDone, 1_000);
      }
    }
    const drained = await settleWithin(outputDone, 1_000);
    if (!drained) {
      await signalOwnedProcess(child, "SIGTERM");
      if (!await settleWithin(outputDone, 1_000)) {
        await signalOwnedProcess(child, "SIGKILL");
        await settleWithin(outputDone, 1_000);
      }
    }
    if (!await settleWithin(outputDone, 250)) {
      stdoutCapture.cancel();
      stderrCapture.cancel();
      await settleWithin(outputDone, 250);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  const stdoutBytes = stdoutCapture.read();
  const stderrBytes = stderrCapture.read();
  const stdout = new TextDecoder().decode(stdoutBytes);
  const stderr = new TextDecoder().decode(stderrBytes);
  await Promise.all([
    Deno.writeFile(`${evidenceDir}/${name}.stdout.txt`, stdoutBytes),
    Deno.writeFile(`${evidenceDir}/${name}.stderr.txt`, stderrBytes),
  ]);
  return {
    exitCode: processState.status?.code ?? null,
    stdout,
    stderr,
    stopReason,
  };
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
