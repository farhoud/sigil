import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DesignInput } from "../../packages/core/src/design-input.ts";
import {
  type AgentName,
  INTERPRETATION_PROMPT,
  runInterpretationAgent,
} from "./agents.ts";
import { runClaimsAttempt } from "./claims.ts";
import {
  type FixturePreflight,
  preflightSlottedFixture,
  SLOTTED_FIXTURE,
} from "./fixture.ts";

export interface BatchSelection {
  readonly agent: AgentName;
  readonly model: string;
}

export interface ScheduledAttempt extends BatchSelection {
  readonly id: string;
  readonly pass: number;
  readonly source: string;
}

export interface AttemptRecord extends ScheduledAttempt {
  readonly status:
    | "pending"
    | "running"
    | "valid"
    | "invalid"
    | "failed"
    | "interrupted";
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly state: "coherent" | "loose" | "disjoint" | null;
  readonly failureStep: string | null;
  readonly error: string | null;
  readonly observedModels: readonly string[];
  readonly modelVerification: "observed" | "unverified" | "mixed";
  readonly presentedFacets: number | null;
  readonly coveredFacets: number | null;
  readonly outcomePath: string | null;
}

export interface BatchManifest {
  readonly version: 1;
  readonly createdAt: string;
  readonly fixture: typeof SLOTTED_FIXTURE;
  readonly fixtureSha256: string;
  readonly preflight: FixturePreflight;
  readonly selections: readonly BatchSelection[];
  readonly passes: number;
  readonly timeoutMs: number;
  readonly schedule: readonly ScheduledAttempt[];
  readonly input: {
    readonly frontendPath: "frontend.json";
    readonly frontendSha256: string;
    readonly sourceSha256: Readonly<Record<string, string>>;
    readonly workspaceMemoPresent: boolean;
  };
  readonly tools: {
    readonly claimsPath: string;
    readonly claimsSha256: string;
    readonly sigilSha256: string;
    readonly understandSha256: string;
    readonly egglogSha256: string;
    readonly promptSha256: string;
    readonly guidanceFingerprint: string;
    readonly vocabularyGeneration: number;
  };
}

export interface BatchOptions {
  readonly selections: readonly BatchSelection[];
  readonly passes: number;
  readonly outputDir: string;
  readonly timeoutMs: number;
  readonly workspaceDir?: string;
  readonly sigilExecutable?: string;
  readonly claimsExecutable?: string;
  readonly skillDirs?: {
    readonly understandDir: string;
    readonly egglogDir: string;
  };
  readonly agentExecutables?: Partial<Record<AgentName, string>>;
  readonly signal?: AbortSignal;
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function validateSelections(
  value: readonly { agent: string; model: string }[],
): asserts value is readonly BatchSelection[] {
  if (value.length === 0) {
    throw new Error("Select at least one agent/model combination");
  }
  const seen = new Set<string>();
  for (const selection of value) {
    if (!["claude", "codex", "pi"].includes(selection.agent)) {
      throw new Error(`Unknown agent: ${selection.agent}`);
    }
    if (!selection.model.trim()) {
      throw new Error(`Missing model for ${selection.agent}`);
    }
    const key = JSON.stringify([selection.agent, selection.model]);
    if (seen.has(key)) {
      throw new Error(
        `Duplicate agent/model selection: ${selection.agent}/${selection.model}`,
      );
    }
    seen.add(key);
  }
}

export function buildSchedule(
  selections: readonly BatchSelection[],
  passes: number,
): ScheduledAttempt[] {
  validateSelections(selections);
  if (!Number.isSafeInteger(passes) || passes < 1) {
    throw new Error("Pass count must be a positive integer");
  }
  const schedule: ScheduledAttempt[] = [];
  for (const selection of selections) {
    for (let pass = 1; pass <= passes; pass++) {
      for (const source of SLOTTED_FIXTURE.sources) {
        schedule.push({
          id: String(schedule.length + 1).padStart(6, "0"),
          agent: selection.agent,
          model: selection.model,
          pass,
          source: source.path,
        });
      }
    }
  }
  return schedule;
}

/** Run the frozen Slotted schedule sequentially, keeping every attempt. */
export async function runBatch(options: BatchOptions): Promise<BatchManifest> {
  const schedule = buildSchedule(options.selections, options.passes);
  const outputDir = resolve(options.outputDir);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("Timeout must be a positive number of milliseconds");
  }
  if (await exists(outputDir)) {
    throw new Error(`Output directory already exists: ${outputDir}`);
  }

  const workspaceDir = options.workspaceDir ??
    join(repoRoot, "examples/slotted");
  const sigil = options.sigilExecutable ?? join(repoRoot, "build/sigil");
  const claims = options.claimsExecutable ??
    join(repoRoot, "packages/sigilc/target/debug/sigil-claims");
  const skills = options.skillDirs ?? {
    understandDir: join(repoRoot, "integrations/skills/sigil-understand"),
    egglogDir: join(repoRoot, "integrations/skills/sigil-egglog"),
  };
  await Deno.mkdir(dirname(outputDir), { recursive: true });
  await Deno.mkdir(outputDir);
  const frontendPath = join(outputDir, "frontend.json");
  const exportResult = await new Deno.Command(sigil, {
    args: [
      "export",
      "design",
      workspaceDir,
      "--root",
      workspaceDir,
      "--format",
      "json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  await Promise.all([
    Deno.writeFile(frontendPath, exportResult.stdout),
    Deno.writeFile(
      join(outputDir, "export.stderr.txt"),
      exportResult.stderr,
    ),
  ]);
  if (exportResult.code !== 0) {
    throw new Error(
      `Slotted export failed: ${new TextDecoder().decode(exportResult.stderr)}`,
    );
  }
  const design = JSON.parse(
    new TextDecoder().decode(exportResult.stdout),
  ) as DesignInput;

  const pinned = join(outputDir, "pinned");
  await Deno.mkdir(pinned);
  const pinnedClaims = join(pinned, "sigil-claims");
  await Deno.copyFile(claims, pinnedClaims);
  await Deno.chmod(pinnedClaims, 0o755);
  const pinnedSkills = {
    understandDir: join(pinned, "sigil-understand"),
    egglogDir: join(pinned, "sigil-egglog"),
  };
  await copySkill(skills.understandDir, pinnedSkills.understandDir);
  await copySkill(skills.egglogDir, pinnedSkills.egglogDir);

  const requests = [];
  let guidanceFingerprint: string | null = null;
  let vocabularyGeneration: number | null = null;
  for (const source of SLOTTED_FIXTURE.sources) {
    const prepDir = join(
      outputDir,
      "preflight",
      basename(source.path, ".sigil"),
    );
    const root = join(
      outputDir,
      "preflight-roots",
      basename(source.path, ".sigil"),
    );
    await Deno.mkdir(dirname(prepDir), { recursive: true });
    const prepared = await new Deno.Command(pinnedClaims, {
      args: [
        "prepare",
        "--frontend",
        frontendPath,
        "--source",
        source.path,
        "--out",
        prepDir,
        "--root",
        root,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await Deno.writeFile(`${prepDir}.stdout.json`, prepared.stdout);
    await Deno.writeFile(`${prepDir}.stderr.txt`, prepared.stderr);
    if (prepared.code !== 0) {
      throw new Error(
        `Fixture prepare failed for ${source.path}: ${
          new TextDecoder().decode(prepared.stderr)
        }`,
      );
    }
    const preparedResult = JSON.parse(
      new TextDecoder().decode(prepared.stdout),
    );
    if (preparedResult.reusedUnits !== 0) {
      throw new Error(`Fixture prepare reused units for ${source.path}`);
    }
    const request = JSON.parse(
      await Deno.readTextFile(join(prepDir, "request.json")),
    );
    const binding = JSON.parse(
      await Deno.readTextFile(join(prepDir, "binding.json")),
    );
    if (
      guidanceFingerprint !== null &&
      guidanceFingerprint !== binding.guidanceFingerprint
    ) {
      throw new Error("Guidance changed during preflight");
    }
    if (
      vocabularyGeneration !== null &&
      vocabularyGeneration !== binding.vocabularyGeneration
    ) {
      throw new Error("Vocabulary changed during preflight");
    }
    guidanceFingerprint = binding.guidanceFingerprint;
    vocabularyGeneration = binding.vocabularyGeneration;
    requests.push(request);
  }
  const preflight = preflightSlottedFixture(design, requests);
  if (!preflight.canSchedule) {
    throw new Error(
      `Slotted source drift: ${preflight.sourceDrift.join("; ")}`,
    );
  }
  const sourceSha256: Record<string, string> = {};
  for (const source of design.sources) {
    sourceSha256[source.path] = await sha256(
      new TextEncoder().encode(source.text),
    );
  }
  const fixtureSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(SLOTTED_FIXTURE)),
  );
  const manifest: BatchManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    fixture: SLOTTED_FIXTURE,
    fixtureSha256,
    preflight,
    selections: options.selections,
    passes: options.passes,
    timeoutMs: options.timeoutMs,
    schedule,
    input: {
      frontendPath: "frontend.json",
      frontendSha256: await sha256(exportResult.stdout),
      sourceSha256,
      workspaceMemoPresent: await exists(
        join(workspaceDir, ".sigil/claims/interpretations"),
      ),
    },
    tools: {
      claimsPath: "pinned/sigil-claims",
      claimsSha256: await sha256(await Deno.readFile(pinnedClaims)),
      sigilSha256: await sha256(await Deno.readFile(sigil)),
      understandSha256: await treeSha256(pinnedSkills.understandDir),
      egglogSha256: await treeSha256(pinnedSkills.egglogDir),
      promptSha256: await sha256(
        new TextEncoder().encode(INTERPRETATION_PROMPT),
      ),
      guidanceFingerprint: guidanceFingerprint!,
      vocabularyGeneration: vocabularyGeneration!,
    },
  };
  await writeJson(join(outputDir, "manifest.json"), manifest);
  for (const planned of schedule) {
    await writeRecord(outputDir, {
      ...planned,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      state: null,
      failureStep: null,
      error: null,
      observedModels: [],
      modelVerification: "unverified",
      presentedFacets: null,
      coveredFacets: null,
      outcomePath: null,
    });
  }

  for (const planned of schedule) {
    if (options.signal?.aborted) break;
    const recordPath = join(outputDir, "records", `${planned.id}.json`);
    const running: AttemptRecord = {
      ...JSON.parse(await Deno.readTextFile(recordPath)),
      status: "running",
      startedAt: new Date().toISOString(),
    };
    await writeRecord(outputDir, running);
    const attemptDir = join(outputDir, "attempts", planned.id);
    try {
      const outcome = await runClaimsAttempt({
        executable: pinnedClaims,
        frontendPath,
        source: planned.source,
        privateRoot: join(attemptDir, "private"),
        preparationDir: join(attemptDir, "prepared"),
        evidenceDir: join(attemptDir, "evidence"),
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        interpret: (preparationDir, evidenceDir, timeoutMs) =>
          runInterpretationAgent({
            agent: planned.agent,
            requestedModel: planned.model,
            preparationDir,
            evidenceDir,
            skillDirs: pinnedSkills,
            timeoutMs,
            signal: options.signal,
            executable: options.agentExecutables?.[planned.agent],
          }),
      });
      const outcomePath = join(attemptDir, "outcome.json");
      await writeJson(outcomePath, outcome);
      await writeRecord(outputDir, {
        ...running,
        status: outcome.status,
        finishedAt: new Date().toISOString(),
        state: outcome.state,
        failureStep: outcome.failureStep,
        error: outcome.error,
        observedModels: outcome.agent?.observedModels ?? [],
        modelVerification: outcome.agent?.modelVerification ?? "unverified",
        presentedFacets: Array.isArray(outcome.request?.rows)
          ? outcome.request.rows.length
          : null,
        coveredFacets: outcome.validation?.coveredFacets ?? null,
        outcomePath: `attempts/${planned.id}/outcome.json`,
      });
    } catch (cause) {
      await writeRecord(outputDir, {
        ...running,
        status: "failed",
        finishedAt: new Date().toISOString(),
        failureStep: "controller",
        error: String(cause),
      });
    }
  }
  return manifest;
}

export async function readBatch(
  outputDir: string,
): Promise<{ manifest: BatchManifest; records: AttemptRecord[] }> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(outputDir, "manifest.json")),
  ) as BatchManifest;
  const records: AttemptRecord[] = [];
  for (const planned of manifest.schedule) {
    try {
      records.push(
        JSON.parse(
          await Deno.readTextFile(
            join(outputDir, "records", `${planned.id}.json`),
          ),
        ),
      );
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause;
      records.push(pendingRecord(planned));
    }
  }
  return { manifest, records };
}

function pendingRecord(planned: ScheduledAttempt): AttemptRecord {
  return {
    ...planned,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    state: null,
    failureStep: null,
    error: null,
    observedModels: [],
    modelVerification: "unverified",
    presentedFacets: null,
    coveredFacets: null,
    outcomePath: null,
  };
}

async function writeRecord(
  outputDir: string,
  record: AttemptRecord,
): Promise<void> {
  await writeJson(join(outputDir, "records", `${record.id}.json`), record);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await Deno.rename(temp, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return false;
    throw cause;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.length);
  stable.set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", stable.buffer),
  );
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function copySkill(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for (const file of ["SKILL.md", "VERSION"]) {
    try {
      await Deno.copyFile(join(source, file), join(destination, file));
    } catch (cause) {
      if (file === "VERSION" && cause instanceof Deno.errors.NotFound) {
        continue;
      }
      throw cause;
    }
  }
  await copyTree(join(source, "references"), join(destination, "references"));
}

async function copyTree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory) await copyTree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
    else throw new Error(`Unsupported skill entry: ${from}`);
  }
}

async function treeSha256(root: string): Promise<string> {
  const rows: string[] = [];
  async function visit(dir: string, prefix: string): Promise<void> {
    const entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) await visit(join(dir, entry.name), name);
      else if (entry.isFile) {
        rows.push(
          `${name}:${await sha256(await Deno.readFile(join(dir, entry.name)))}`,
        );
      }
    }
  }
  await visit(root, "");
  return sha256(new TextEncoder().encode(rows.join("\n")));
}
