import { join } from "node:path";
import {
  type CapturedStream,
  captureStream,
  settleWithin,
  signalOwnedProcess,
} from "./process.ts";

export type AgentName = "claude" | "codex" | "pi";
export type AgentStatus = "completed" | "failed" | "timeout" | "cancelled";
export type ModelVerification = "observed" | "unverified" | "mixed";

const OUTPUT_DRAIN_GRACE_MS = 500;
const TERMINATION_GRACE_MS = 2_000;
const PROBE_TIMEOUT_MS = 5_000;

export interface AgentRunRequest {
  readonly agent: AgentName;
  readonly requestedModel: string;
  /**
   * Fresh native prepare directory. Only its brief and guidance are copied
   * into the child workspace; it is never exposed in place.
   */
  readonly preparationDir: string;
  /** Attempt-specific retained directory under the batch. */
  readonly evidenceDir: string;
  readonly skillDirs: {
    readonly understandDir: string;
    readonly egglogDir: string;
  };
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Overrides PATH lookup, useful for a pinned executable or a fake host. */
  readonly executable?: string;
}

export interface AgentRunResult {
  readonly status: AgentStatus;
  readonly failureStep: "launch" | "child" | "artifact" | null;
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly agent: AgentName;
  readonly requestedModel: string;
  readonly observedModels: readonly string[];
  readonly modelVerification: ModelVerification;
  readonly hostVersion: string | null;
  readonly executable: string;
  /** Effective CLI flags, excluding the prompt (retained separately). */
  readonly settings: readonly string[];
  readonly isolationLimits: readonly string[];
  readonly stagedWorkspace: string;
  readonly promptPath: string;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  /** Exact final message bytes. Null when the child never completed a message. */
  readonly finalResponsePath: string | null;
}

/**
 * The prepared files a child may read. `request.json` and `binding.json` stay
 * on the controller side for coverage checks and ingest.
 */
export const STAGED_PREPARATION = [
  "brief.md",
  "sections.md",
  "vocabulary.md",
  "examples.md",
  "rejected.md",
] as const;

export const INTERPRETATION_PROMPT =
  `Interpret the Sigil claims preparation in this workspace. This is one fresh interpretation task.\n\nRead preparation/brief.md, every guidance file in preparation/, skills/sigil-egglog/SKILL.md, and skills/sigil-egglog/references/dialect.md. Read other skill references only when a presented Facet needs a specific rule. skills/sigil-understand/ is optional background. The prepared guidance controls the accepted row format and names.\n\nReturn only the complete data rows for every [fN] line in the brief, including contextual Facets. Name each Facet by its [fN] handle, such as "f1". An explicit reading row is appropriate when a Facet asserts no claim. Preserve whole Logic groupings. Do not run sigil-claims or inspect any repository or prior attempt. No explanation, markdown fence, or repaired summary. Your final message must be the exact claims artifact.\n`;

/** Launches one isolated interpretation process and retains its raw evidence. */
export async function runInterpretationAgent(
  request: AgentRunRequest,
): Promise<AgentRunResult> {
  const deadline = Date.now() + request.timeoutMs;
  await Deno.mkdir(request.evidenceDir, { recursive: true });
  const promptPath = join(request.evidenceDir, "prompt.txt");
  const stdoutPath = join(request.evidenceDir, "stdout.jsonl");
  const stderrPath = join(request.evidenceDir, "stderr.txt");
  const finalPath = join(request.evidenceDir, "final-response.txt");
  await Deno.writeTextFile(promptPath, INTERPRETATION_PROMPT);
  await Deno.writeFile(stdoutPath, new Uint8Array());
  await Deno.writeFile(stderrPath, new Uint8Array());

  const stagedWorkspace = await Deno.makeTempDir({
    prefix: "sigil-slotted-child-",
  });
  const executable = request.executable ?? request.agent;
  let settings: string[] = [];
  let hostVersion: string | null = null;
  let status: AgentStatus = "failed";
  let failureStep: AgentRunResult["failureStep"] = null;
  let error: string | null = null;
  let exitCode: number | null = null;
  let finalResponsePath: string | null = null;
  try {
    await stagePreparation(
      request.preparationDir,
      join(stagedWorkspace, "preparation"),
    );
    await stageSkill(
      request.skillDirs.understandDir,
      join(stagedWorkspace, "skills/sigil-understand"),
    );
    await stageSkill(
      request.skillDirs.egglogDir,
      join(stagedWorkspace, "skills/sigil-egglog"),
    );
    const outputFile = join(stagedWorkspace, "codex-final-response.txt");
    settings = commandArgs(request.agent, request.requestedModel, outputFile);
    if (request.signal?.aborted) {
      status = "cancelled";
    } else if (Date.now() >= deadline) {
      status = "timeout";
    } else {
      hostVersion = await probeVersion(
        executable,
        Math.max(0, deadline - Date.now()),
        request.signal,
      );
      if (request.signal?.aborted) {
        status = "cancelled";
      } else if (Date.now() >= deadline) {
        status = "timeout";
      } else {
        let child: Deno.ChildProcess;
        try {
          child = new Deno.Command(executable, {
            args: [...settings, INTERPRETATION_PROMPT],
            cwd: stagedWorkspace,
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
            // On POSIX this gives the child a process group of its own. The
            // group can then be terminated even if the host exits before one of
            // its descendants closes the captured output streams.
            detached: true,
          }).spawn();
        } catch (cause) {
          failureStep = "launch";
          error = String(cause);
          return buildResult();
        }
        const stdoutDrain = startDrain(child.stdout, stdoutPath);
        const stderrDrain = startDrain(child.stderr, stderrPath);
        let stopped: "timeout" | "cancelled" | null = null;
        let forceTimer: ReturnType<typeof setTimeout> | undefined;
        const stop = (reason: "timeout" | "cancelled") => {
          if (stopped) return;
          stopped = reason;
          void signalOwnedProcess(child, "SIGTERM");
          forceTimer = setTimeout(() => {
            void signalOwnedProcess(child, "SIGKILL");
          }, TERMINATION_GRACE_MS);
        };
        const timeout = setTimeout(
          () => stop("timeout"),
          Math.max(0, deadline - Date.now()),
        );
        const onAbort = () => stop("cancelled");
        request.signal?.addEventListener("abort", onAbort, { once: true });
        if (request.signal?.aborted) onAbort();
        try {
          const result = await child.status;
          exitCode = result.code;
          await finishDrains(child, [stdoutDrain, stderrDrain], () => stopped);
        } finally {
          clearTimeout(timeout);
          if (forceTimer !== undefined) clearTimeout(forceTimer);
          request.signal?.removeEventListener("abort", onAbort);
        }
        if (stopped) {
          status = stopped;
        } else if (exitCode !== 0) {
          status = "failed";
          failureStep = "child";
          error = `Agent exited ${exitCode}`;
        } else {
          const final = await extractFinalResponse(
            request.agent,
            stdoutPath,
            outputFile,
          );
          if (final === null) {
            status = "failed";
            failureStep = "artifact";
            error = "Agent completed without a final response";
          } else {
            await Deno.writeFile(finalPath, final);
            finalResponsePath = finalPath;
            status = "completed";
          }
        }
      }
    }
  } finally {
    await Deno.remove(stagedWorkspace, { recursive: true });
  }
  return buildResult();

  async function buildResult(): Promise<AgentRunResult> {
    const observedModels = await servedModels(request.agent, stdoutPath);
    return {
      status,
      failureStep,
      error,
      exitCode,
      agent: request.agent,
      requestedModel: request.requestedModel,
      observedModels,
      modelVerification: observedModels.length === 0
        ? "unverified"
        : observedModels.length === 1
        ? "observed"
        : "mixed",
      hostVersion,
      executable,
      settings,
      isolationLimits: isolationLimits(request.agent),
      stagedWorkspace,
      promptPath,
      stdoutPath,
      stderrPath,
      finalResponsePath,
    };
  }
}

function commandArgs(
  agent: AgentName,
  model: string,
  outputFile: string,
): string[] {
  switch (agent) {
    case "claude":
      return [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--no-session-persistence",
        "--restricted",
        "--safe-mode",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "Read,Glob,Grep",
        "--",
      ];
    case "codex":
      return [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--sandbox",
        "read-only",
        "-C",
        "./",
        "--skip-git-repo-check",
        "--model",
        model,
        "--output-last-message",
        outputFile,
      ];
    case "pi":
      return [
        "--print",
        "--mode",
        "json",
        "--model",
        model,
        "--no-session",
        "--no-context-files",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--tools",
        "read,grep,find,ls",
        "--",
      ];
  }
}

function isolationLimits(agent: AgentName): string[] {
  switch (agent) {
    case "claude":
      return [
        "Managed settings may still apply; CLI restrictions are not an OS sandbox.",
      ];
    case "codex":
      return ["Read-only sandbox may still read outside the staged workspace."];
    case "pi":
      return [
        "Read-only tool allowlist limits available tools, not OS-level file access.",
      ];
  }
}

async function probeVersion(
  executable: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted) return null;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let child: Deno.ChildProcess | undefined;
  const state: { status: Deno.CommandStatus | null } = { status: null };
  let stopResolve: (() => void) | undefined;
  try {
    child = new Deno.Command(executable, {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
      detached: true,
    }).spawn();
    const output = captureStream(child.stdout, 16_384);
    const statusDone = child.status.then((result) => {
      state.status = result;
    });
    const stopPromise = new Promise<void>((resolve) => {
      stopResolve = resolve;
    });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      void signalOwnedProcess(child!, "SIGTERM");
      stopResolve?.();
      forceTimer = setTimeout(() => {
        void signalOwnedProcess(child!, "SIGKILL");
      }, OUTPUT_DRAIN_GRACE_MS);
    };
    const timer = setTimeout(
      stop,
      Math.max(0, Math.min(timeoutMs, PROBE_TIMEOUT_MS)),
    );
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    try {
      await Promise.race([statusDone, stopPromise]);
      if (state.status === null) {
        await settleWithin(statusDone, TERMINATION_GRACE_MS + 250);
        if (state.status === null) {
          await signalOwnedProcess(child, "SIGKILL");
          await settleWithin(statusDone, OUTPUT_DRAIN_GRACE_MS);
        }
      }
      const outputFinished = await finishProbeOutput(
        child,
        output,
        () => stopped,
      );
      const probeStatus = state.status;
      return !stopped && outputFinished && probeStatus?.success
        ? new TextDecoder().decode(output.read()).trim()
        : null;
    } finally {
      clearTimeout(timer);
      if (forceTimer !== undefined) clearTimeout(forceTimer);
      signal?.removeEventListener("abort", stop);
    }
  } catch {
    if (child) {
      try {
        await signalOwnedProcess(child, "SIGKILL");
      } catch { /* Best effort cleanup after a failed probe. */ }
    }
    return null;
  }
}

async function stagePreparation(
  source: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for (const name of STAGED_PREPARATION) {
    await Deno.copyFile(join(source, name), join(destination, name));
  }
}

async function stageSkill(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for (const name of ["SKILL.md", "VERSION"]) {
    try {
      await Deno.copyFile(join(source, name), join(destination, name));
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound && name === "VERSION") continue;
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
    else throw new Error(`Non-file staged input: ${from}`);
  }
}

interface StreamDrain {
  readonly done: Promise<void>;
  cancel(): void;
}

function startDrain(
  stream: ReadableStream<Uint8Array>,
  path: string,
): StreamDrain {
  const reader = stream.getReader();
  const done = (async () => {
    const file = await Deno.open(path, { write: true, truncate: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let offset = 0;
        while (offset < value.length) {
          offset += await file.write(value.subarray(offset));
        }
      }
    } finally {
      reader.releaseLock();
      file.close();
    }
  })();
  return {
    done,
    cancel() {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* The reader may have completed between the check and cancel. */
      }
    },
  };
}

async function finishDrains(
  child: Deno.ChildProcess,
  drains: readonly StreamDrain[],
  wasStopped: () => "timeout" | "cancelled" | null,
): Promise<void> {
  const allDone = Promise.all(drains.map((drain) => drain.done));
  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) {
    await allDone;
    return;
  }

  // A host can exit while a descendant still owns stdout or stderr. Signal
  // the detached process group even though the host status promise has ended.
  if (wasStopped() === null) {
    await signalOwnedProcess(child, "SIGTERM");
    const forceTimer = setTimeout(
      () => void signalOwnedProcess(child, "SIGKILL"),
      OUTPUT_DRAIN_GRACE_MS,
    );
    const ended = await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS + 100);
    if (!ended) await signalOwnedProcess(child, "SIGKILL");
    clearTimeout(forceTimer);
  } else {
    // Let the timeout/cancellation's existing SIGKILL grace elapse, but never
    // wait indefinitely for a descendant to close an inherited pipe.
    const ended = await settleWithin(allDone, TERMINATION_GRACE_MS + 250);
    if (!ended) await signalOwnedProcess(child, "SIGKILL");
  }

  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) {
    await allDone;
    return;
  }
  for (const drain of drains) drain.cancel();
  if (await settleWithin(allDone, OUTPUT_DRAIN_GRACE_MS)) await allDone;
}

async function finishProbeOutput(
  child: Deno.ChildProcess,
  output: CapturedStream,
  wasStopped: () => boolean,
): Promise<boolean> {
  const ended = await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
  if (ended) return true;
  if (!wasStopped()) await signalOwnedProcess(child, "SIGTERM");
  await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
  if (!output.isDone()) await signalOwnedProcess(child, "SIGKILL");
  if (await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS)) return true;
  output.cancel();
  return await settleWithin(output.done, OUTPUT_DRAIN_GRACE_MS);
}

async function extractFinalResponse(
  agent: AgentName,
  stdoutPath: string,
  codexOutputFile: string,
): Promise<Uint8Array | null> {
  if (agent === "codex") {
    try {
      return await Deno.readFile(codexOutputFile);
    } catch (cause) {
      if (cause instanceof Deno.errors.NotFound) return null;
      throw cause;
    }
  }
  let final: string | null = null;
  for (const event of jsonEvents(await Deno.readTextFile(stdoutPath))) {
    if (
      agent === "claude" && event.type === "result" &&
      typeof event.result === "string"
    ) {
      final = event.result;
    }
    if (agent === "pi" && event.type === "message_end") {
      const message = record(event.message);
      if (message?.role !== "assistant" || !Array.isArray(message.content)) {
        continue;
      }
      final = message.content.map((part) => {
        const block = record(part);
        return block?.type === "text" && typeof block.text === "string"
          ? block.text
          : "";
      }).join("");
    }
  }
  return final === null ? null : new TextEncoder().encode(final);
}

async function servedModels(
  agent: AgentName,
  stdoutPath: string,
): Promise<string[]> {
  const models = new Set<string>();
  for (const event of jsonEvents(await Deno.readTextFile(stdoutPath))) {
    if (
      agent === "claude" && event.type === "assistant" &&
      event.is_api_error_message !== true
    ) {
      const model = record(event.message)?.model;
      if (
        typeof model === "string" && model.length && !model.startsWith("<")
      ) {
        models.add(model);
      }
    }
    if (agent === "pi" && event.type === "message_end") {
      const message = record(event.message);
      if (message?.role !== "assistant") continue;
      const model = message.model;
      if (typeof model === "string" && model.length) {
        const provider = message.provider;
        models.add(
          typeof provider === "string" && provider.length
            ? `${provider}/${model}`
            : model,
        );
      }
    }
  }
  return [...models];
}

function* jsonEvents(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const event = record(JSON.parse(line));
      if (event) yield event;
    } catch {
      // Raw bytes stay in stdout.jsonl; malformed events provide no metadata.
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
