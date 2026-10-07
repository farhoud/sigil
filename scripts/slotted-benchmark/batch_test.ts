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
import { SLOTTED_FIXTURE } from "./fixture.ts";

Deno.test("two agent/model combinations across three passes schedule six distinct passes", () => {
  const schedule = buildSchedule([
    { agent: "claude", model: "sonnet" },
    { agent: "codex", model: "gpt-6" },
  ], 3);
  equal(schedule.length, 6);
  equal(new Set(schedule.map((attempt) => attempt.id)).size, 6);
  deepEqual(
    new Set(schedule.map((attempt) => attempt.pass)),
    new Set([1, 2, 3]),
  );
  for (const pass of [1, 2, 3]) {
    equal(schedule.filter((attempt) => attempt.pass === pass).length, 2);
  }
});

Deno.test("one selection and two passes schedule two pass records covering seven sources each", () => {
  const schedule = buildSchedule([{ agent: "claude", model: "sonnet" }], 2);
  equal(schedule.length, 2);
  deepEqual(schedule.map((attempt) => attempt.pass), [1, 2]);
  for (const attempt of schedule) {
    deepEqual(
      attempt.sources,
      SLOTTED_FIXTURE.sources.map((source) => source.path),
    );
    equal(attempt.sources.length, 7);
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

Deno.test("frozen batch retains one pending pass record when cancelled before launches", async () => {
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
    equal(manifest.schedule.length, 1);
    equal(retained.records.length, 1);
    equal(manifest.schedule[0].sources.length, 7);
    equal(
      retained.records.every((record) => record.status === "pending"),
      true,
    );
    // The linked check reads every source's private sections, so the
    // ownership problem Rooms states in its state section is scorable.
    deepEqual(
      manifest.preflight.issues.map((issue) => issue.status),
      ["scorable", "scorable", "scorable", "scorable"],
    );
    equal(Object.keys(manifest.input.sourceSha256).length, 7);
    equal(manifest.input.workspaceMemoPresent, false);

    await Deno.remove(`${outputDir}/records/${manifest.schedule[0].id}.json`);
    const recovered = await readBatch(outputDir);
    equal(recovered.records.length, 1);
    deepEqual(recovered.records[0], {
      ...manifest.schedule[0],
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
      sourceResults: [],
      outcomePath: null,
    });
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("existing output directory is refused before the tree read or child launch", async () => {
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
        sigilcExecutable: "/missing/sigilc",
      });
    } catch (cause) {
      message = String(cause);
    }
    equal(message.includes("Output directory already exists"), true);
  } finally {
    await Deno.remove(outputDir, { recursive: true });
  }
});

Deno.test("missing pinned skill fails before scheduling attempts", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-skill-test-" });
  try {
    const missing = `${root}/missing-skill`;
    await Deno.mkdir(`${missing}/references`, { recursive: true });
    let error = "";
    try {
      await runBatch({
        selections: [{ agent: "claude", model: "unlaunched" }],
        passes: 1,
        outputDir: `${root}/batch`,
        timeoutMs: 1000,
        skillDirs: {
          understandDir: missing,
          egglogDir: "integrations/skills/sigil-egglog",
        },
      });
    } catch (cause) {
      error = String(cause);
    }
    equal(error.includes("SKILL.md"), true, error);
    equal(await exists(`${root}/batch/manifest.json`), false);
    equal(await exists(`${root}/batch/records`), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return false;
    throw cause;
  }
}
