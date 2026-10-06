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

const GUIDANCE = ["sections.md", "vocabulary.md", "examples.md", "rejected.md"];

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
  await Deno.writeTextFile(
    `${preparationDir}/brief.md`,
    "# Interpretation brief\n\n[f1] Prose.\n",
  );
  for (const name of GUIDANCE) {
    await Deno.writeTextFile(`${preparationDir}/${name}`, "Rows guidance\n");
  }
  await Deno.writeTextFile(`${preparationDir}/notes.txt`, "not staged\n");
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
      `test -f preparation/brief.md || exit 7
for name in ${GUIDANCE.join(" ")}; do
  test -f "preparation/$name" || exit 11
done
test ! -e preparation/request.json || exit 12
test ! -e preparation/binding.json || exit 13
test ! -e preparation/notes.txt || exit 14
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
    for (
      const required of [
        "preparation/brief.md",
        "every guidance file in preparation/",
        "skills/sigil-egglog/SKILL.md",
        "skills/sigil-egglog/references/dialect.md",
        "[fN]",
      ]
    ) {
      assert(prompt.includes(required), `prompt omits ${required}`);
    }
    assert(!prompt.includes("request.json"), "prompt names request.json");
    assert(!prompt.includes("binding.json"), "prompt names binding.json");
    for (const sentence of prompt.split(/(?<=\.)\s+/)) {
      assert(
        !sentence.includes("sigil-understand") ||
          sentence.toLowerCase().includes("optional"),
        `prompt requires sigil-understand: ${sentence}`,
      );
    }
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

Deno.test("a hanging version probe obeys the attempt timeout", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-version-test-" });
  try {
    const options = await context(root);
    const executable = `${root}/host.sh`;
    await Deno.writeTextFile(
      executable,
      `#!/bin/sh
if [ "$1" = "--version" ]; then exec sleep 10; fi
printf '%s\\n' '{"type":"result","result":"unexpected"}'
`,
    );
    await Deno.chmod(executable, 0o755);
    const started = Date.now();
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "fake",
      executable,
      timeoutMs: 150,
    });
    assert(result.status === "timeout", `wrong status: ${result.status}`);
    assert(Date.now() - started < 3_000, "version probe stalled the batch");
    assert(result.finalResponsePath === null, "main child was launched");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("staging consumes the timeout budget before any host probe", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-stage-deadline-" });
  try {
    const options = await context(root);
    await Deno.writeFile(
      `${options.skillDirs.understandDir}/references/large.bin`,
      new Uint8Array(8 * 1024 * 1024),
    );
    const calls = `${root}/host-calls`;
    const executable = `${root}/slow-version.sh`;
    await Deno.writeTextFile(
      executable,
      `#!/bin/sh
echo called >> ${calls}
if [ "$1" = "--version" ]; then sleep 1; exit 0; fi
exit 1
`,
    );
    await Deno.chmod(executable, 0o755);
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "sonnet",
      executable,
      timeoutMs: 1,
    });
    assert(result.status === "timeout", JSON.stringify(result));
    try {
      await Deno.stat(calls);
      throw new Error("host probe ran after staging exhausted the deadline");
    } catch (cause) {
      assert(cause instanceof Deno.errors.NotFound, String(cause));
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a version probe's descendant cannot hold its output open", async () => {
  const root = await Deno.makeTempDir({
    prefix: "slotted-version-child-test-",
  });
  try {
    const options = await context(root);
    const executable = `${root}/host.sh`;
    await Deno.writeTextFile(
      executable,
      `#!/bin/sh
if [ "$1" = "--version" ]; then sleep 8 & printf 'fake 1.2.3\\n'; exit 0; fi
printf '%s\\n' '{"type":"result","result":"[]"}'
`,
    );
    await Deno.chmod(executable, 0o755);
    const started = Date.now();
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "fake",
      executable,
      timeoutMs: 5_000,
    });
    assert(result.status === "completed", JSON.stringify(result));
    assert(result.hostVersion === "fake 1.2.3", "version output was lost");
    assert(
      Date.now() - started < 3_000,
      "version descendant stalled the attempt",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a host's descendant cannot hold output pipes open for the next attempt", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-descendant-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `if [ ! -e descendant-started ]; then touch descendant-started; sleep 8 & fi\nprintf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const started = Date.now();
    const first = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "first",
      executable,
      timeoutMs: 5_000,
    });
    assert(first.status === "completed", JSON.stringify(first));
    assert(
      Date.now() - started < 3_000,
      "descendant kept the first attempt open",
    );

    const second = await runInterpretationAgent({
      ...options,
      evidenceDir: `${root}/second-evidence`,
      agent: "claude",
      requestedModel: "second",
      executable,
      timeoutMs: 5_000,
    });
    assert(second.status === "completed", "later attempt did not proceed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cancellation remains active while child output drains", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-drain-cancel-test-" });
  try {
    const options = await context(root);
    const executable = await fakeHost(
      root,
      `if [ "$1" = "--version" ]; then exit 0; fi\n(trap '' TERM; while :; do sleep 1; done) &\nprintf '%s\\n' '{"type":"result","result":"[]"}'`,
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 700);
    const result = await runInterpretationAgent({
      ...options,
      agent: "claude",
      requestedModel: "cancel-during-drain",
      executable,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    assert(result.status === "cancelled", `wrong status: ${result.status}`);
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
        setTimeout(() => controller.abort(), 300);
      }
      const result = await runInterpretationAgent({
        ...options,
        agent: "claude",
        requestedModel: "model-a",
        executable,
        timeoutMs: 500,
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
