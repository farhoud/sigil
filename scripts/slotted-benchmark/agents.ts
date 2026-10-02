import { join } from "node:path";

export type AgentName = "claude" | "codex" | "pi";
export type AgentStatus = "completed" | "failed" | "timeout" | "cancelled";
export type ModelVerification = "observed" | "unverified" | "mixed";

export interface AgentRunRequest {
  readonly agent: AgentName;
  readonly requestedModel: string;
  /** Fresh native prepare directory. It is copied, never exposed in place. */
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

export const INTERPRETATION_PROMPT =
  `Interpret the Sigil claims preparation in this workspace. This is one fresh interpretation task.\n\nRead preparation/request.json, preparation/binding.json, and every guidance file in preparation/. Read skills/sigil-understand/SKILL.md, skills/sigil-understand/references/understanding.md, skills/sigil-egglog/SKILL.md, and skills/sigil-egglog/references/dialect.md. Read other skill references only when a presented Facet needs a specific rule. The prepared guidance controls the accepted row format and names.\n\nReturn only the complete data rows for every presented Facet, including contextual Facets. An explicit reading row is appropriate when a Facet asserts no claim. Preserve whole Logic groupings. Do not run sigil-claims or inspect any repository or prior attempt. No explanation, markdown fence, or repaired summary. Your final message must be the exact claims artifact.\n`;

/** Launches one isolated interpretation process and retains its raw evidence. */
export async function runInterpretationAgent(
  request: AgentRunRequest,
): Promise<AgentRunResult> {
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
    await copyTree(
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
    hostVersion = await probeVersion(executable);
    if (request.signal?.aborted) {
      status = "cancelled";
    } else {
      let child: Deno.ChildProcess;
      try {
        child = new Deno.Command(executable, {
          args: [...settings, INTERPRETATION_PROMPT],
          cwd: stagedWorkspace,
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        }).spawn();
      } catch (cause) {
        failureStep = "launch";
        error = String(cause);
        return buildResult();
      }
      const stdoutDone = drain(child.stdout, stdoutPath);
      const stderrDone = drain(child.stderr, stderrPath);
      let stopped: "timeout" | "cancelled" | null = null;
      let exited = false;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = (reason: "timeout" | "cancelled") => {
        if (stopped || exited) return;
        stopped = reason;
        try {
          child.kill("SIGTERM");
        } catch {
          // The child may have exited between the status check and the signal.
        }
        forceTimer = setTimeout(() => {
          if (!exited) {
            try {
              child.kill("SIGKILL");
            } catch {
              // Already exited.
            }
          }
        }, 2_000);
      };
      const timeout = setTimeout(() => stop("timeout"), request.timeoutMs);
      const onAbort = () => stop("cancelled");
      request.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await child.status;
        exited = true;
        exitCode = result.code;
        await Promise.all([stdoutDone, stderrDone]);
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

async function probeVersion(executable: string): Promise<string | null> {
  try {
    const result = await new Deno.Command(executable, {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
    }).output();
    return result.success
      ? new TextDecoder().decode(result.stdout).trim()
      : null;
  } catch {
    return null;
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

async function drain(
  stream: ReadableStream<Uint8Array>,
  path: string,
): Promise<void> {
  const file = await Deno.open(path, { write: true, truncate: true });
  try {
    for await (const chunk of stream) {
      let offset = 0;
      while (offset < chunk.length) {
        offset += await file.write(chunk.subarray(offset));
      }
    }
  } finally {
    file.close();
  }
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
