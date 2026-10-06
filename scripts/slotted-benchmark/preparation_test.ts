import { strictEqual as equal } from "node:assert/strict";
import { basename } from "node:path";
import { STAGED_PREPARATION } from "./agents.ts";

const repo = (path: string) =>
  new URL(`../../${path}`, import.meta.url).pathname;
const cli = repo("build/sigil");
const claims = repo("packages/sigilc/target/debug/sigil-claims");
const workspace = repo("examples/slotted");

/** The skill files the benchmark prompt requires beside the staged files. */
const REQUIRED_SKILL = [
  "integrations/skills/sigil-egglog/SKILL.md",
  "integrations/skills/sigil-egglog/references/dialect.md",
];
const SIZE_GATE_BYTES = 25_600;

async function exportSlotted(scratch: string): Promise<string> {
  const exported = await new Deno.Command(cli, {
    args: [
      "export",
      "design",
      workspace,
      "--root",
      workspace,
      "--format",
      "json",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(exported.code, 0, new TextDecoder().decode(exported.stderr));
  const frontendPath = `${scratch}/frontend.json`;
  await Deno.writeFile(frontendPath, exported.stdout);
  return frontendPath;
}

async function prepare(
  scratch: string,
  frontendPath: string,
  source: string,
): Promise<string> {
  const name = basename(source, ".sigil");
  const out = `${scratch}/prepared/${name}`;
  const prepared = await new Deno.Command(claims, {
    args: [
      "prepare",
      "--frontend",
      frontendPath,
      "--source",
      source,
      "--out",
      out,
      "--root",
      `${scratch}/roots/${name}`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  equal(prepared.code, 0, new TextDecoder().decode(prepared.stderr));
  return out;
}

Deno.test("availability's required reading stays under the size gate", async () => {
  const scratch = await Deno.makeTempDir({ prefix: "slotted-size-gate-" });
  try {
    const frontendPath = await exportSlotted(scratch);
    const out = await prepare(scratch, frontendPath, "availability.sigil");
    const sizes: Record<string, number> = {};
    for (const name of STAGED_PREPARATION) {
      sizes[name] = (await Deno.stat(`${out}/${name}`)).size;
    }
    for (const path of REQUIRED_SKILL) {
      sizes[path] = (await Deno.stat(repo(path))).size;
    }
    const total = Object.values(sizes).reduce((sum, size) => sum + size, 0);
    equal(
      total < SIZE_GATE_BYTES,
      true,
      `required reading is ${total} bytes, gate ${SIZE_GATE_BYTES}: ${
        JSON.stringify(sizes)
      }`,
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
});
