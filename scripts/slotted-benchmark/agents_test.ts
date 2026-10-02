import { type AgentRunRequest, runInterpretationAgent } from "./agents.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fakeHost(root: string, body: string): Promise<string> {
  const path = `${root}/host.sh`;
  await Deno.writeTextFile(
    path,
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf 'fake 1.2.3\\n'; exit 0; fi\n${body}\n`,
  );
  await Deno.chmod(path, 0o755);
  return path;
}

async function context(
  root: string,
): Promise<Omit<AgentRunRequest, "agent" | "requestedModel" | "executable">> {
  const preparationDir = `${root}/preparation`;
  const understandDir = `${root}/understand`;
  const egglogDir = `${root}/egglog`;
  const evidenceDir = `${root}/evidence`;
  await Deno.mkdir(preparationDir);
  await Deno.writeTextFile(`${preparationDir}/request.json`, '{"rows":[]}\n');
  await Deno.writeTextFile(
    `${preparationDir}/binding.json`,
    '{"source":"identity.sigil"}\n',
  );
  await Deno.writeTextFile(`${preparationDir}/sections.md`, "Rows guidance\n");
  for (const dir of [understandDir, egglogDir]) {
    await Deno.mkdir(`${dir}/references`, { recursive: true });
    await Deno.writeTextFile(`${dir}/SKILL.md`, "Pinned skill\n");
    await Deno.writeTextFile(`${dir}/references/detail.md`, "Pinned detail\n");
  }
  await Deno.writeTextFile(
    `${root}/fixture-answer-key.json`,
    "must stay hidden",
  );
  return {
    preparationDir,
    evidenceDir,
    skillDirs: { understandDir, egglogDir },
    timeoutMs: 5_000,
  };
}

Deno.test("Claude adapter keeps exact final rows and served model event", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `test -f preparation/request.json || exit 7
test -f skills/sigil-understand/SKILL.md || exit 8
test -f skills/sigil-egglog/references/detail.md || exit 9
test ! -e fixture-answer-key.json || exit 10
printf '%s\\n' '{"type":"assistant","message":{"model":"claude-sonnet-observed","content":[{"type":"text","text":"draft"}]}}'
printf '%s\\n' '{"type":"result","result":"{\\\"facet\\\":\\\"F1\\\"}\\n"}'`,
    );
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "sonnet",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(result.hostVersion === "fake 1.2.3", "host version missing");
    assert(
      result.modelVerification === "observed",
      "served model not observed",
    );
    assert(
      result.observedModels.join() === "claude-sonnet-observed",
      "wrong model",
    );
    assert(result.finalResponsePath !== null, "response path missing");
    assert(
      await Deno.readTextFile(result.finalResponsePath) === '{"facet":"F1"}\n',
      "final response bytes changed",
    );
    assert(
      (await Deno.readTextFile(result.stdoutPath)).includes("draft"),
      "raw event absent",
    );
    const prompt = await Deno.readTextFile(result.promptPath);
    assert(
      prompt.includes("request.json"),
      "prepared request absent from prompt",
    );
    assert(!prompt.includes("fixture-answer-key"), "answer key in prompt");
    assert(
      result.settings.includes("--restricted"),
      "host restrictions unrecorded",
    );
    assert(
      !await exists(result.stagedWorkspace),
      "temporary workspace retained",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Codex requested-model echo is unverified", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output-last-message' ]; then shift; output="$1"; fi
  shift
done
printf '{"facet":"F2"}\\n' > "$output"
printf '%s\\n' '{"type":"thread.started","model":"requested-only"}'`,
    );
    const result = await runInterpretationAgent({
      ...options,
      agent: "codex",
      requestedModel: "requested-only",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(
      result.modelVerification === "unverified",
      "request echo was trusted",
    );
    assert(result.observedModels.length === 0, "request echo was observed");
    assert(result.finalResponsePath !== null, "response path missing");
    assert(
      await Deno.readTextFile(result.finalResponsePath) === '{"facet":"F2"}\n',
      "Codex bytes changed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Claude rate-limit synthetic assistant is not a served model", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"assistant","is_api_error_message":true,"message":{"model":"<synthetic>","content":[{"type":"text","text":"rate limit"}]}}'
printf '%s\\n' '{"type":"result","is_error":true,"result":"rate limit"}'
exit 1`,
    );
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "sonnet",
      executable,
    });
    assert(result.status === "failed", "error was treated as completed");
    assert(
      result.modelVerification === "unverified",
      "synthetic error attributed to a model",
    );
    assert(result.observedModels.length === 0, "synthetic model retained");
    assert(
      result.finalResponsePath === null,
      "error text became a claims artifact",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Pi marks two served model IDs mixed", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","model":"model-a","content":[{"type":"text","text":"first"}]}}'
printf '%s\\n' '{"type":"message_end","message":{"role":"assistant","model":"model-b","content":[{"type":"text","text":"second\\n"}]}}'`,
    );
    const result = await runInterpretationAgent({
      ...options,
      agent: "pi",
      requestedModel: "provider/model-a",
      executable,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(
      result.modelVerification === "mixed",
      "mixed model run attributed to one",
    );
    assert(
      result.observedModels.join() === "model-a,model-b",
      "model IDs lost",
    );
    assert(result.finalResponsePath !== null, "response path missing");
    assert(
      await Deno.readTextFile(result.finalResponsePath) === "second\n",
      "Pi bytes changed",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("launch failure is recorded and does not poison another host", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
  try {
    const options = await context(root);
    const failed = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "missing",
      executable: `${root}/does-not-exist`,
    });
    assert(
      failed.status === "failed" && failed.failureStep === "launch",
      "missing host not recorded",
    );
    const executable = await fakeHost(
      root,
      `printf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const succeeded = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "available",
      executable,
    });
    assert(succeeded.status === "completed", "later host did not run");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

for (const termination of ["timeout", "cancelled"] as const) {
  Deno.test(`${termination} ends child and retains partial output`, async () => {
    const root = await Deno.makeTempDir({ prefix: "slotted-agent-test-" });
    try {
      const options = await context(root);
      const executable = await fakeHost(
        root,
        `printf '%s\\n' '{"type":"assistant","message":{"model":"model-a"}}'
while :; do :; done`,
      );
      const controller = new AbortController();
      if (termination === "cancelled") {
        setTimeout(() => controller.abort(), 100);
      }
      const result = await runInterpretationAgent({
        ...options,
        agent: "claude",
        requestedModel: "model-a",
        executable,
        timeoutMs: 150,
        signal: termination === "cancelled" ? controller.signal : undefined,
      });
      assert(
        result.status === termination,
        `wrong termination: ${result.status}`,
      );
      assert(
        (await Deno.readTextFile(result.stdoutPath)).includes("model-a"),
        "partial event lost",
      );
      assert(result.finalResponsePath === null, "partial output became rows");
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
