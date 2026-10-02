import { match as matches, strictEqual as equal } from "node:assert/strict";
import { runBatch } from "./batch.ts";
import { executeCommand } from "./main.ts";

async function fakeClaude(root: string): Promise<string> {
  const path = `${root}/fake-claude.py`;
  await Deno.writeTextFile(
    path,
    `#!/usr/bin/env python3
import json, sys
if '--version' in sys.argv:
    print('fake-claude 1.0')
    sys.exit(0)
with open('preparation/request.json', encoding='utf8') as f:
    request = json.load(f)
rows = '\\n'.join('(reading ' + json.dumps(row['facet']) + ' "no-commitment")' for row in request['rows']) + '\\n'
print(json.dumps({'type': 'assistant', 'message': {'model': 'served-fake-model'}}))
print(json.dumps({'type': 'result', 'result': rows}))
`,
  );
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test("run launches seven fake-host interpretations and report regenerates without launch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-cli-test-" });
  try {
    const host = await fakeClaude(root);
    const batch = `${root}/batch`;
    const launched = await executeCommand([
      "run",
      "--agent",
      "claude:requested-fake-model",
      "--passes",
      "1",
      "--out",
      batch,
      "--timeout-ms",
      "10000",
    ], { agentExecutables: { claude: host } });
    equal(launched.batchDir, batch);
    equal(
      launched.valid,
      7,
      `expected seven valid attempts; see ${batch}/report.md`,
    );
    const report = await Deno.readTextFile(`${batch}/report.md`);
    matches(report, /## Runs/);
    matches(report, /## Agent and model comparison/);
    matches(report, /requested-fake-model/);
    matches(report, /served-fake-model \(observed\)/);
    equal((report.match(/\| 00000[1-7] \| claude \|/g) ?? []).length, 7);
    equal(
      (report.match(
        /\| claude \| requested-fake-model \| served-fake-model \(observed\) \| `[^`]+` \|/g,
      ) ?? []).length,
      7,
    );
    await Deno.writeTextFile(
      host,
      "#!/usr/bin/env python3\nraise RuntimeError('report launched a child')\n",
    );
    const regenerated = await executeCommand(["report", batch]);
    equal(regenerated.reportPath, `${batch}/report.md`);
    equal(await Deno.readTextFile(regenerated.reportPath), report);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unknown agent or missing model fails before export and child launch", async () => {
  for (const value of ["unknown:model", "claude:"]) {
    let error = "";
    try {
      await executeCommand([
        "run",
        "--agent",
        value,
        "--passes",
        "1",
        "--out",
        "/missing/should-not-be-created",
      ]);
    } catch (cause) {
      error = String(cause);
    }
    matches(error, /Unknown agent|Missing model/);
  }
});

Deno.test("demo points to the tool fixture and labels old runs historical", async () => {
  const doc = await Deno.readTextFile(
    new URL("../../docs/computed-evaluation-demo.md", import.meta.url),
  );
  matches(doc, /scripts\/slotted-benchmark\/fixture\.ts/);
  matches(doc, /## Run the current benchmark/);
  matches(doc, /historical observations/);
  equal(doc.includes("## The seven files"), false);
  equal(doc.includes("## The four deliberate problems"), false);
});

Deno.test("report rebuilds a partial batch with all pending rows and no launch", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-partial-report-" });
  const batch = `${root}/batch`;
  const controller = new AbortController();
  controller.abort();
  try {
    await runBatch({
      selections: [{ agent: "claude", model: "unavailable" }],
      passes: 1,
      outputDir: batch,
      timeoutMs: 1000,
      signal: controller.signal,
      agentExecutables: { claude: "/missing/agent" },
    });
    const result = await executeCommand(["report", batch]);
    equal(result.unfinished, 7);
    const markdown = await Deno.readTextFile(result.reportPath);
    equal((markdown.match(/\| pending \|/g) ?? []).length, 7);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
