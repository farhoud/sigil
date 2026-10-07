import { match as matches, strictEqual as equal } from "node:assert/strict";
import { readBatch, runBatch } from "./batch.ts";
import { executeCommand } from "./main.ts";

async function fakeClaude(
  root: string,
  planted = false,
  failSource: string | null = null,
): Promise<string> {
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
if ${
      failSource === null
        ? "False"
        : "True"
    } and request['binding']['source'] == ${JSON.stringify(failSource)}:
    sys.stderr.write('reader failed')
    sys.exit(3)
rows = []
for row in request['rows']:
    if row.get('context'):
        continue
    facet = json.dumps(row['facet'])
    if ${
      planted ? "True" : "False"
    } and row['section'] == 'interface' and 'Booking provides a renter a *range change*' in row['prose']:
        rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "true")')
    elif ${
      planted ? "True" : "False"
    } and row['section'] == 'constraints' and 'Booking must not provide a range change' in row['prose']:
        rows.append('(claim ' + facet + ' "Booking" "provides" "range change" "required" "false")')
    else:
        rows.append('(reading ' + facet + ' "no-commitment")')
rows = '\\n'.join(rows) + '\\n'
print(json.dumps({'type': 'assistant', 'message': {'model': 'served-fake-model'}}))
print(json.dumps({'type': 'result', 'result': rows}))
`,
  );
  await Deno.chmod(path, 0o755);
  return path;
}

Deno.test("run launches seven fake-host interpretations in one pass, ends with one check, and the report regenerates without launch", async () => {
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
    equal(launched.scheduled, 1);
    equal(
      launched.valid,
      1,
      `expected one valid pass; see ${batch}/report.md`,
    );
    // Seven readings, then exactly one linked check for the pass.
    const { records } = await readBatch(batch);
    equal(records[0].sourceResults.length, 7);
    equal(
      records[0].sourceResults.every((entry) => entry.status === "valid"),
      true,
    );
    equal(
      (await Deno.readTextFile(
        `${batch}/attempts/000001/evidence/check/check.stdout.txt`,
      )).includes('"scope": "workspace"'),
      true,
    );
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000001/outcome.json`),
    );
    equal(outcome.sources.length, 7);
    equal(outcome.linked.validation.valid, true);
    equal(outcome.linked.report.unread.length, 0);
    await Deno.stat(
      `${batch}/attempts/000001/private/claims/workspace.linked.json`,
    );
    const report = await Deno.readTextFile(`${batch}/report.md`);
    matches(report, /## Runs/);
    matches(report, /## Agent and model comparison/);
    matches(report, /requested-fake-model/);
    matches(report, /served-fake-model \(observed\)/);
    equal((report.match(/\| 000001 \| claude \|/g) ?? []).length, 1);
    matches(report, /\| 1 \| 7\/7 \| valid \|/);
    equal((report.match(/## Source readings/g) ?? []).length, 1);
    equal(
      (report.match(/\| 000001 \| 1 \| `[^`]+` \| valid \|/g) ?? []).length,
      7,
    );
    equal(
      (report.match(
        /\| claude \| requested-fake-model \| served-fake-model \(observed\) \| 1 \| 1 \|/g,
      ) ?? []).length,
      1,
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

Deno.test("failed host does not block later native detection and report", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-continued-test-" });
  try {
    const host = await fakeClaude(root, true);
    const batch = `${root}/batch`;
    const result = await executeCommand([
      "run",
      "--agent",
      "codex:missing-model",
      "--agent",
      "claude:fake-model",
      "--passes",
      "1",
      "--out",
      batch,
      "--timeout-ms",
      "10000",
    ], {
      agentExecutables: { codex: `${root}/missing`, claude: host },
    });
    equal(result.scheduled, 2);
    equal(result.failed, 1);
    equal(result.interrupted, 0);
    equal(result.valid, 1);
    const { records } = await readBatch(batch);
    equal(records[0].status, "failed");
    equal(records[1].status, "valid");
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000002/outcome.json`),
    );
    equal(outcome.status, "valid", outcome.error ?? "");
    equal(
      outcome.linked.report.findings.some((finding: { law: string }) =>
        finding.law === "contradictory-claims"
      ),
      true,
    );
    const report = await Deno.readTextFile(result.reportPath);
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /Attempt 000002, `booking-pending-range-contradiction`: linked finding/,
    );
    matches(
      report,
      /\[report\]\(attempts\/000002\/private\/claims\/workspace\.linked\.json\)/,
    );
    matches(report, /\| 000001 \| codex \| missing-model .*\| failed \|/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("a pass whose host fails one source names it unread, scores the rest, and fails the gate", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-incomplete-test-" });
  try {
    const host = await fakeClaude(root, true, "rooms.sigil");
    const batch = `${root}/batch`;
    const result = await executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      "--passes",
      "1",
      "--out",
      batch,
      "--timeout-ms",
      "10000",
    ], { agentExecutables: { claude: host } });
    equal(result.scheduled, 1);
    equal(result.failed, 1);
    const { records } = await readBatch(batch);
    // A gating finding outranks incompleteness; the unread list still names
    // the source, and claims_test covers the `incomplete` state itself.
    equal(records[0].state, "disjoint");
    equal(
      records[0].sourceResults.filter((entry) => entry.status === "valid")
        .length,
      6,
    );
    const outcome = JSON.parse(
      await Deno.readTextFile(`${batch}/attempts/000001/outcome.json`),
    );
    equal(outcome.linked.exitCode, 1);
    equal(
      outcome.linked.report.unread.some((entry: { source: string }) =>
        entry.source === "rooms.sigil"
      ),
      true,
    );
    const report = await Deno.readTextFile(result.reportPath);
    // Booking's contradiction still scores; Rooms' ownership anchor was unread.
    matches(report, /booking-pending-range-contradiction: 1\/1/);
    matches(
      report,
      /booking-rooms-archived-mark-ownership: 0\/0 \(1 unavailable\)/,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unknown agent or missing model fails before the tree read and child launch", async () => {
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
    equal(result.unfinished, 1);
    const markdown = await Deno.readTextFile(result.reportPath);
    equal((markdown.match(/\| pending \|/g) ?? []).length, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("an aborted run records the active attempt as interrupted", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-abort-test-" });
  const marker = `${root}/started`;
  const host = `${root}/hanging-claude.py`;
  await Deno.writeTextFile(
    host,
    `#!/usr/bin/env python3
import pathlib, time
pathlib.Path(${JSON.stringify(marker)}).write_text('started', encoding='utf8')
while True: time.sleep(1)
`,
  );
  await Deno.chmod(host, 0o755);
  const controller = new AbortController();
  try {
    const pending = executeCommand([
      "run",
      "--agent",
      "claude:fake-model",
      "--passes",
      "1",
      "--out",
      `${root}/batch`,
      "--timeout-ms",
      "30000",
    ], { agentExecutables: { claude: host }, signal: controller.signal });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await Deno.stat(marker);
        break;
      } catch (cause) {
        if (!(cause instanceof Deno.errors.NotFound)) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    await Deno.stat(marker);
    controller.abort();
    const result = await pending;
    equal(result.interrupted, 1);
    equal(result.unfinished, 0);
    const { records } = await readBatch(`${root}/batch`);
    equal(records[0].status, "interrupted");
  } finally {
    controller.abort();
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("CLI SIGINT and SIGTERM stop the detached host and write a report", async () => {
  const root = await Deno.makeTempDir({ prefix: "slotted-cli-signal-test-" });
  try {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const batch = `${root}/${signal}`;
      const marker = `${root}/${signal}-started`;
      const host = `${root}/${signal}-host.py`;
      await Deno.writeTextFile(
        host,
        `#!/usr/bin/env python3
import pathlib, sys, time
if '--version' in sys.argv:
    print('fake-claude 1.0')
    sys.exit(0)
pathlib.Path(${JSON.stringify(marker)}).write_text('started', encoding='utf8')
while True: time.sleep(1)
`,
      );
      await Deno.chmod(host, 0o755);
      const bin = `${root}/${signal}-bin`;
      await Deno.mkdir(bin);
      await Deno.symlink(host, `${bin}/claude`);
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-run",
          "--allow-env=PATH",
          "scripts/slotted-benchmark/main.ts",
          "run",
          "--agent",
          "claude:fake-model",
          "--passes",
          "1",
          "--out",
          batch,
          "--timeout-ms",
          "30000",
        ],
        env: { PATH: `${bin}:${Deno.env.get("PATH") ?? ""}` },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const output = child.output();
      try {
        const deadline = Date.now() + 15_000;
        let started = false;
        while (Date.now() < deadline) {
          try {
            await Deno.stat(marker);
            started = true;
            break;
          } catch (cause) {
            if (!(cause instanceof Deno.errors.NotFound)) throw cause;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        }
        equal(started, true, `host did not start for ${signal}`);
        child.kill(signal);
        const result = await output;
        equal(result.code, 0, new TextDecoder().decode(result.stderr));
        const { records } = await readBatch(batch);
        equal(records[0].status, "interrupted");
        matches(await Deno.readTextFile(`${batch}/report.md`), /interrupted/);
      } finally {
        try {
          child.kill("SIGKILL");
        } catch { /* The child already exited. */ }
        try {
          await output;
        } catch { /* The child failed before producing output. */ }
      }
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
