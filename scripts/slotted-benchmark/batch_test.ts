import {
  deepStrictEqual as deepEqual,
  strictEqual as equal,
} from "node:assert/strict";
import {
  buildSchedule,
  readBatch,
  runBatch,
  validateSelections,
} from "./batch.ts";

Deno.test("two agent/model combinations across three passes schedule 42 distinct attempts", () => {
  const schedule = buildSchedule([
    { agent: "claude", model: "sonnet" },
    { agent: "codex", model: "gpt-6" },
  ], 3);
  equal(schedule.length, 42);
  equal(new Set(schedule.map((attempt) => attempt.id)).size, 42);
  deepEqual(
    new Set(schedule.map((attempt) => attempt.pass)),
    new Set([1, 2, 3]),
  );
  for (const pass of [1, 2, 3]) {
    equal(schedule.filter((attempt) => attempt.pass === pass).length, 14);
  }
});

Deno.test("invalid passes, unknown agents, and duplicate selections fail before launch", () => {
  for (const passes of [0, -1, 1.5]) {
    try {
      buildSchedule([{ agent: "pi", model: "provider/model" }], passes);
      throw new Error("accepted invalid pass count");
    } catch (error) {
      if (String(error).includes("accepted invalid")) throw error;
    }
  }
  try {
    validateSelections([
      { agent: "pi", model: "provider/model" },
      { agent: "pi", model: "provider/model" },
    ]);
    throw new Error("accepted duplicate selection");
  } catch (error) {
    if (String(error).includes("accepted duplicate")) throw error;
  }
  try {
    validateSelections([{ agent: "other", model: "model" }]);
    throw new Error("accepted unknown agent");
  } catch (error) {
    if (String(error).includes("accepted unknown")) throw error;
  }
});

Deno.test("frozen batch retains seven pending records when cancelled before launches", async () => {
  const outputDir = await Deno.makeTempDir({ prefix: "slotted-batch-test-" });
  await Deno.remove(outputDir);
  const controller = new AbortController();
  controller.abort();
  try {
    const manifest = await runBatch({
      selections: [{ agent: "claude", model: "unlaunched" }],
      passes: 1,
      outputDir,
      timeoutMs: 1000,
      signal: controller.signal,
    });
    const retained = await readBatch(outputDir);
    equal(manifest.schedule.length, 7);
    equal(retained.records.length, 7);
    equal(
      retained.records.every((record) => record.status === "pending"),
      true,
    );
    equal(
      manifest.preflight.issues.every((issue) => issue.status === "scorable"),
      true,
    );
    equal(Object.keys(manifest.input.sourceSha256).length, 7);
    equal(manifest.input.workspaceMemoPresent, false);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("existing output directory is refused before export or child launch", async () => {
  const outputDir = await Deno.makeTempDir({
    prefix: "slotted-existing-batch-",
  });
  try {
    let message = "";
    try {
      await runBatch({
        selections: [{ agent: "claude", model: "unlaunched" }],
        passes: 1,
        outputDir,
        timeoutMs: 1000,
        sigilExecutable: "/missing/sigil",
      });
    } catch (cause) {
      message = String(cause);
    }
    equal(message.includes("Output directory already exists"), true);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});
