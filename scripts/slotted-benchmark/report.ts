import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { type AttemptRecord, type BatchManifest, readBatch } from "./batch.ts";
import { sourceName } from "./claims.ts";
import type { IssuePreflight } from "./fixture.ts";

type JsonObject = Record<string, unknown>;
export interface ReportAttempt {
  readonly record: AttemptRecord;
  readonly outcome: JsonObject | null;
  /** The exact rows each source's reader returned. */
  readonly rows: ReadonlyMap<string, string>;
}

interface FindingAnalysis {
  /** True once the pass's linked report validated, so its findings are scored. */
  readonly scored: boolean;
  /** Planted problems whose anchor Facets were unread in this pass. */
  readonly unavailable: ReadonlySet<string>;
  readonly matched: ReadonlyMap<string, readonly number[]>;
  readonly extra: readonly number[];
  readonly findings: readonly JsonObject[];
  readonly claimFacet: ReadonlyMap<string, string>;
}

/** Rebuild the report from durable records and artifacts without any model call. */
export async function writeReport(batchDir: string): Promise<string> {
  const { manifest, records } = await readBatch(batchDir);
  const attempts: ReportAttempt[] = [];
  for (const record of records) {
    let outcome: JsonObject | null = null;
    const rows = new Map<string, string>();
    if (record.outcomePath) {
      try {
        outcome = object(
          JSON.parse(
            await Deno.readTextFile(join(batchDir, record.outcomePath)),
          ),
        );
      } catch {
        // The record remains visible; the missing artifact is a reportable limit.
      }
      // The private store is `private`; runs from before `--store` kept the
      // claims under `private/.sigil`.
      const privateStore = resolve(batchDir, "attempts", record.id, "private");
      const privateClaimsDir =
        await pathExists(join(privateStore, ".sigil", "claims"))
          ? join(privateStore, ".sigil", "claims")
          : join(privateStore, "claims");
      const sources: unknown[] = [];
      for (const entry of array(outcome?.sources)) {
        const sourceOutcome = object(entry);
        if (!sourceOutcome || typeof sourceOutcome.source !== "string") {
          continue;
        }
        const source = sourceOutcome.source;
        let rewritten: JsonObject = sourceOutcome;
        const child = object(sourceOutcome.agent);
        if (typeof child?.finalResponsePath === "string") {
          const canonicalPath = resolve(
            batchDir,
            "attempts",
            record.id,
            "evidence",
            sourceName(source),
            "child",
            "final-response.txt",
          );
          const canonicalRows = await readFileIfPresent(canonicalPath);
          if (canonicalRows) rows.set(source, canonicalRows.text);
          rewritten = {
            ...rewritten,
            agent: { ...child, finalResponsePath: canonicalRows?.path ?? null },
          };
        }
        const ingest = object(sourceOutcome.ingestResult);
        if (ingest) {
          const reportPath = join(privateClaimsDir, `${source}.json`);
          const contextPath = join(privateClaimsDir, `${source}.context.json`);
          rewritten = {
            ...rewritten,
            ingestResult: {
              ...ingest,
              report: await pathExists(reportPath) ? reportPath : null,
              judgmentContext: await pathExists(contextPath)
                ? contextPath
                : null,
            },
          };
        }
        sources.push(rewritten);
      }
      if (outcome) outcome = { ...outcome, sources };
      const linked = object(outcome?.linked);
      const linkedResult = object(linked?.result);
      if (outcome && linked && linkedResult) {
        const reportPath = join(privateClaimsDir, "workspace.linked.json");
        const contextPath = join(
          privateClaimsDir,
          "workspace.linked.context.json",
        );
        outcome = {
          ...outcome,
          linked: {
            ...linked,
            result: {
              ...linkedResult,
              report: await pathExists(reportPath) ? reportPath : null,
              judgmentContext: await pathExists(contextPath)
                ? contextPath
                : null,
            },
          },
        };
      }
    }
    const linked = object(outcome?.linked);
    const hasEvidence = outcome && object(linked?.report) &&
      object(linked?.context) &&
      array(outcome.sources).every((entry) => {
        const source = object(entry)?.source;
        return typeof source === "string" && rows.has(source);
      });
    attempts.push({
      record: record.status === "valid" && !hasEvidence
        ? {
          ...record,
          status: "invalid",
          state: null,
          failureStep: "evidence",
          error: "retained outcome or rows missing",
        }
        : record,
      outcome,
      rows,
    });
  }
  const path = join(batchDir, "report.md");
  await writeReportFile(
    path,
    renderReport(manifest, attempts, batchDir),
  );
  return path;
}

async function writeReportFile(path: string, contents: string): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${crypto.randomUUID()}.tmp`,
  );
  try {
    const temporary = await Deno.open(temporaryPath, {
      write: true,
      createNew: true,
    });
    try {
      await temporary.write(new TextEncoder().encode(contents));
      await temporary.sync();
    } finally {
      temporary.close();
    }
    try {
      await Deno.remove(path);
    } catch (cause) {
      if (!(cause instanceof Deno.errors.NotFound)) throw cause;
    }
    await Deno.rename(temporaryPath, path);
  } catch (cause) {
    try {
      await Deno.remove(temporaryPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Deno.errors.NotFound)) throw cleanupError;
    }
    throw cause;
  }
}

export function renderReport(
  manifest: BatchManifest,
  attempts: readonly ReportAttempt[],
  batchDir = ".",
): string {
  const byId = new Map(attempts.map((attempt) => [attempt.record.id, attempt]));
  const ordered = manifest.schedule.map((planned) =>
    byId.get(planned.id) ?? {
      record: {
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
        sourceResults: [],
        outcomePath: null,
      } as AttemptRecord,
      outcome: null,
      rows: new Map<string, string>(),
    }
  );
  const analysis = new Map(
    ordered.map((
      attempt,
    ) => [attempt.record.id, analyze(attempt, manifest.preflight.issues)]),
  );
  const lines: string[] = [
    "# Slotted interpretation benchmark",
    "",
    `Batch created: ${manifest.createdAt}. Fixture version: ${manifest.fixture.version}.`,
    manifest.input.workspaceDigest
      ? `Workspace digest: \`${manifest.input.workspaceDigest}\`.`
      : "Workspace digest: not recorded.",
    "",
    manifest.fixture.description,
    "",
    "## Slotted fixture",
    "",
    "| Source | Role | Imports | Target |",
    "| --- | --- | --- | --- |",
  ];
  for (const source of manifest.fixture.sources) {
    lines.push(
      `| \`${source.path}\` | ${cell(source.role)} | ${
        source.imports.join(", ") || "—"
      } | ${source.target.state} / ${source.target.exitCode} |`,
    );
  }
  lines.push(
    "",
    "### Planted problems",
    "",
    "| ID | Explanation | Intended finding | Evidence | Remedy | Fixture check |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const issue of manifest.preflight.issues) {
    const evidence = issue.anchors.map((anchor) =>
      `${anchor.source} ${anchor.section}: ${anchor.text.replaceAll("\n", " ")}`
    ).join("; ");
    lines.push(
      `| \`${issue.id}\` | ${
        cell(issue.explanation)
      } | ${issue.findingClass} / ${issue.laws.join(", ")} | ${
        cell(evidence)
      } | ${cell(issue.remedy)} | ${
        issue.status === "scorable"
          ? "scorable"
          : `drift: ${cell(issue.reason ?? "unknown")}`
      } |`,
    );
  }
  if (manifest.preflight.sourceDrift.length) {
    lines.push(
      "",
      `Source or import drift: ${
        manifest.preflight.sourceDrift.map(cell).join("; ")
      }.`,
    );
  }

  lines.push(
    "",
    "## Runs",
    "",
    "One row per scheduled pass. A pass reads every source into one private store, then runs one linked check; planted problems are scored from that linked report. A planted problem whose anchor Facets were unread in a pass is N/A for that pass. A running record from an ended controller is shown as interrupted.",
    "",
    "| # | Agent | Requested model | Observed model | Pass | Sources read | Validity | Linked state | Planted findings | Additional findings | Facet coverage | Evidence |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- | --- | ---: | --- | --- |",
  );
  for (const attempt of ordered) {
    const record = attempt.record;
    const finding = analysis.get(record.id)!;
    const planted = manifest.preflight.issues.map((issue) =>
      issue.status === "drift"
        ? `${issue.id}: N/A`
        : !finding.scored
        ? ""
        : finding.unavailable.has(issue.id)
        ? `${issue.id}: N/A`
        : finding.matched.has(issue.id)
        ? issue.id
        : ""
    ).filter(Boolean).join(", ") || "—";
    const coverage = record.presentedFacets === null
      ? "—"
      : `${record.coveredFacets ?? 0}/${record.presentedFacets}`;
    const read = record.sourceResults.length
      ? `${
        record.sourceResults.filter((entry) =>
          entry.status === "valid"
        ).length
      }/${record.sources.length}`
      : "—";
    const evidence = [`[record](records/${record.id}.json)`];
    if (record.outcomePath) {
      evidence.push(`[outcome](${record.outcomePath})`);
    }
    const linked = object(object(attempt.outcome?.linked)?.result);
    for (
      const [label, key] of [["linked report", "report"], [
        "linked context",
        "judgmentContext",
      ]] as const
    ) {
      const link = relativeLink(batchDir, linked?.[key]);
      if (link) evidence.push(`[${label}](${link})`);
    }
    lines.push(
      `| ${record.id} | ${cell(record.agent)} | ${cell(record.model)} | ${
        observed(record)
      } | ${record.pass} | ${read} | ${
        record.status === "running" ? "interrupted" : record.status
      } | ${finding.scored ? record.state : "—"} | ${cell(planted)} | ${
        finding.scored ? finding.extra.length : "—"
      } | ${coverage} | ${evidence.join(", ")} |`,
    );
  }

  lines.push(
    "",
    "## Source readings",
    "",
    "One row per source in each pass. The state is the source's own ingest verdict, before linking.",
    "",
    "| # | Pass | Source | Validity | Own state | Facet coverage | Evidence |",
    "| --- | ---: | --- | --- | --- | --- | --- |",
  );
  for (const attempt of ordered) {
    const record = attempt.record;
    for (const result of record.sourceResults) {
      const evidence = [];
      const sourceOutcome = array(attempt.outcome?.sources).map(object).find((
        entry,
      ) => entry?.source === result.source);
      const rowsLink = relativeLink(
        batchDir,
        object(sourceOutcome?.agent)?.finalResponsePath,
      );
      if (rowsLink) evidence.push(`[rows](${rowsLink})`);
      const ingest = object(sourceOutcome?.ingestResult);
      for (
        const [label, key] of [["native report", "report"], [
          "context",
          "judgmentContext",
        ]] as const
      ) {
        const link = relativeLink(batchDir, ingest?.[key]);
        if (link) evidence.push(`[${label}](${link})`);
      }
      lines.push(
        `| ${record.id} | ${record.pass} | \`${result.source}\` | ${result.status} | ${
          result.status === "valid" ? result.state : "—"
        } | ${
          result.presentedFacets === null
            ? "—"
            : `${result.coveredFacets ?? 0}/${result.presentedFacets}`
        } | ${evidence.join(", ") || "—"} |`,
      );
    }
  }

  const groups = groupAttempts(ordered);
  lines.push(
    "",
    "## Agent and model comparison",
    "",
    "Counts are observations on this captured Slotted snapshot. Detection, additional findings, and repeatability are separate measures; there is no overall rank. Detection counts only passes whose linked check validated and whose anchor Facets were read.",
    "",
    "| Agent | Requested model | Observed model | Passes | Valid | Failed / invalid / interrupted / pending | Linked states | Planted problem detection | Additional finding frequencies (identity passes/scored) | Facet coverage |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | ---: |",
  );
  for (const group of groups) {
    const valid = group.filter((attempt) => attempt.record.status === "valid");
    const scored = group.filter((attempt) =>
      analysis.get(attempt.record.id)!.scored
    );
    const sample = group[0].record;
    const counts = [
      group.filter((attempt) => attempt.record.status === "failed").length,
      group.filter((attempt) => attempt.record.status === "invalid").length,
      group.filter((attempt) =>
        attempt.record.status === "interrupted" ||
        attempt.record.status === "running"
      ).length,
      group.filter((attempt) => attempt.record.status === "pending").length,
    ];
    const states = ["coherent", "loose", "disjoint", "incomplete"].map((
      state,
    ) =>
      `${state} ${
        scored.filter((attempt) => attempt.record.state === state).length
      }`
    ).join(", ");
    const detections = manifest.preflight.issues.map((issue) => {
      if (issue.status === "drift") return `${issue.id}: N/A`;
      const available = scored.filter((attempt) =>
        !analysis.get(attempt.record.id)!.unavailable.has(issue.id)
      );
      const found = available.filter((attempt) =>
        analysis.get(attempt.record.id)!.matched.has(issue.id)
      ).length;
      const withheld = scored.length - available.length;
      return `${issue.id}: ${found}/${available.length}${
        withheld ? ` (${withheld} unavailable)` : ""
      }`;
    }).join("; ") || "—";
    const extraTotal = scored.reduce(
      (sum, attempt) => sum + analysis.get(attempt.record.id)!.extra.length,
      0,
    );
    const extraFrequencies = additionalFindingFrequencies(scored, analysis);
    const covered = group.reduce(
      (sum, attempt) => sum + (attempt.record.coveredFacets ?? 0),
      0,
    );
    const presented = group.reduce(
      (sum, attempt) => sum + (attempt.record.presentedFacets ?? 0),
      0,
    );
    lines.push(
      `| ${cell(sample.agent)} | ${cell(sample.model)} | ${
        observed(sample)
      } | ${group.length} | ${valid.length} | ${
        counts.join(" / ")
      } | ${states} | ${cell(detections)} | ${
        cell(
          `${extraTotal} total; ${
            extraFrequencies.join("; ") || "no additional findings"
          }`,
        )
      } | ${presented ? `${covered}/${presented}` : "—"} |`,
    );
  }

  lines.push("", "## Planted finding evidence", "");
  let knownCount = 0;
  for (const attempt of ordered) {
    const analyzed = analysis.get(attempt.record.id)!;
    if (!analyzed.scored) continue;
    for (const [issueId, indices] of analyzed.matched) {
      knownCount++;
      const reportLink = relativeLink(
        batchDir,
        object(object(attempt.outcome?.linked)?.result)?.report,
      ) ?? attempt.record.outcomePath;
      lines.push(
        `- Attempt ${attempt.record.id}, \`${issueId}\`: linked finding ${
          indices.map((index) => index + 1).join(", ")
        } ([report](${reportLink})).`,
      );
    }
  }
  if (!knownCount) {
    lines.push("No planted findings were detected in scored passes.");
  }

  lines.push("", "## Additional findings for review", "");
  let extraCount = 0;
  for (const attempt of ordered) {
    const analyzed = analysis.get(attempt.record.id)!;
    if (!analyzed.scored) continue;
    for (const index of analyzed.extra) {
      const finding = analyzed.findings[index];
      extraCount++;
      lines.push(
        `- Attempt ${attempt.record.id}, finding ${index + 1}: \`${
          cell(finding.class)
        } / ${cell(finding.law)}\`, subject \`${
          cell(finding.subject)
        }\`, object \`${cell(finding.object)}\`, claims \`${
          cell(array(finding.claims).join(", "))
        }\` ([evidence](${attempt.record.outcomePath})).`,
      );
    }
  }
  if (!extraCount) lines.push("No additional findings in scored passes.");

  lines.push("", "## Variation across valid repeated runs", "");
  let varied = 0;
  for (const group of groups) {
    for (const source of manifest.fixture.sources.map((entry) => entry.path)) {
      const valid = group.filter((attempt) =>
        attempt.record.sourceResults.some((entry) =>
          entry.source === source && entry.status === "valid"
        ) && attempt.rows.has(source)
      );
      if (valid.length < 2) continue;
      const rowMaps = valid.map((attempt) =>
        rowsByFacet(attempt.rows.get(source)!)
      );
      const facets = [...new Set(rowMaps.flatMap((map) => [...map.keys()]))]
        .sort();
      for (const facet of facets) {
        const versions = rowMaps.map((map) =>
          (map.get(facet) ?? []).slice().sort().join("\n")
        );
        if (new Set(versions).size <= 1) continue;
        varied++;
        const sample = valid[0].record;
        lines.push(
          `### ${sample.agent} / ${sample.model} / ${source} / ${facet}`,
          "",
        );
        for (let index = 0; index < valid.length; index++) {
          const attempt = valid[index];
          lines.push(
            `<details><summary>Attempt ${attempt.record.id}, pass ${attempt.record.pass} — <a href="attempts/${attempt.record.id}/evidence/${
              sourceName(source)
            }/child/final-response.txt">original rows</a></summary>`,
            "",
            "```egglog",
            versions[index] || "(no row)",
            "```",
            "",
            "</details>",
            "",
          );
        }
      }
    }
  }
  if (!varied) {
    lines.push(
      "No differing Facet rows among groups with at least two valid saved interpretations.",
    );
  }
  lines.push(
    "",
    "Additional findings need review before they can be called interpretation errors. This report describes only the saved attempts on the captured snapshot.",
    "",
  );
  return lines.join("\n");
}

function analyze(
  attempt: ReportAttempt,
  issues: readonly IssuePreflight[],
): FindingAnalysis {
  const linked = object(attempt.outcome?.linked);
  const report = object(linked?.report);
  const findings = array(report?.findings).map(object)
    .filter((entry): entry is JsonObject => entry !== null);
  // A pass is scored when its linked check validated, even if the check
  // reported the workspace incomplete: what was read is still judged.
  if (!report || object(linked?.validation)?.valid !== true) {
    return {
      scored: false,
      unavailable: new Set(),
      matched: new Map(),
      extra: [],
      findings,
      claimFacet: new Map(),
    };
  }
  // Claims of every source map to their Facets through the linked context.
  const claimFacet = new Map<string, string>();
  for (const unit of array(object(linked?.context)?.units)) {
    const row = object(unit);
    if (typeof row?.facet !== "string") continue;
    for (const asserted of array(row.asserted)) {
      const claim = object(asserted)?.claim;
      if (typeof claim === "string") claimFacet.set(claim, row.facet);
    }
  }
  const unreadFacets = new Set<string>();
  const unreadSources = new Set<string>();
  for (const entry of array(report.unread)) {
    const unread = object(entry);
    if (!unread) continue;
    const facets = array(unread.facets).filter((facet): facet is string =>
      typeof facet === "string"
    );
    for (const facet of facets) unreadFacets.add(facet);
    if (facets.length === 0 && typeof unread.source === "string") {
      unreadSources.add(unread.source);
    }
  }
  const unavailable = new Set<string>();
  const matched = new Map<string, number[]>();
  const consumed = new Set<number>();
  for (const issue of issues) {
    if (issue.status !== "scorable") continue;
    if (
      issue.facets.some((facet) => unreadFacets.has(facet)) ||
      issue.anchors.some((anchor) => unreadSources.has(anchor.source))
    ) {
      unavailable.add(issue.id);
      continue;
    }
    const indices: number[] = [];
    for (let index = 0; index < findings.length; index++) {
      if (matchesIssue(findings[index], issue, claimFacet)) {
        indices.push(index);
        consumed.add(index);
      }
    }
    if (indices.length) matched.set(issue.id, indices);
  }
  return {
    scored: true,
    unavailable,
    matched,
    extra: findings.map((_, index) => index).filter((index) =>
      !consumed.has(index)
    ),
    findings,
    claimFacet,
  };
}

function additionalFindingFrequencies(
  valid: readonly ReportAttempt[],
  analysis: ReadonlyMap<string, FindingAnalysis>,
): string[] {
  const frequencies = new Map<
    string,
    { display: string; attempts: Set<string> }
  >();
  for (const attempt of valid) {
    const findings = analysis.get(attempt.record.id)!;
    for (const index of findings.extra) {
      const finding = findings.findings[index];
      const identity = extraFindingIdentity(finding, findings.claimFacet);
      const entry = frequencies.get(identity.key) ?? {
        display: identity.display,
        attempts: new Set<string>(),
      };
      entry.attempts.add(attempt.record.id);
      frequencies.set(identity.key, entry);
    }
  }
  return [...frequencies.values()]
    .sort((left, right) => left.display.localeCompare(right.display))
    .map((entry) => `${entry.display}: ${entry.attempts.size}/${valid.length}`);
}

function extraFindingIdentity(
  finding: JsonObject,
  claimFacet: ReadonlyMap<string, string>,
): { key: string; display: string } {
  const findingClass = String(finding.class ?? "unknown");
  const law = String(finding.law ?? "unknown");
  const rawSubject = String(finding.subject ?? "unknown");
  const subjectFacet = claimFacet.get(rawSubject);
  const subject = subjectFacet ? `Facet ${subjectFacet}` : rawSubject;
  const object = String(finding.object ?? "unknown");
  return {
    key: JSON.stringify([findingClass, law, subject, object]),
    display: `${findingClass} / ${law} / ${subject} / ${object}`,
  };
}

function matchesIssue(
  finding: JsonObject,
  issue: IssuePreflight,
  claimFacet: ReadonlyMap<string, string>,
): boolean {
  if (
    finding.class !== issue.findingClass ||
    !issue.laws.includes(String(finding.law))
  ) return false;
  const claims = array(finding.claims).filter((claim): claim is string =>
    typeof claim === "string"
  );
  if (
    !claims.some((claim) => issue.facets.includes(claimFacet.get(claim) ?? ""))
  ) return false;
  const evidence = issue.findingEvidence;
  if (evidence.subject === "cited-claim") {
    return claims.includes(String(finding.subject)) &&
      finding.object === evidence.object;
  }
  return (finding.subject === evidence.subject &&
    finding.object === evidence.object) ||
    (evidence.eitherDirection === true && finding.subject === evidence.object &&
      finding.object === evidence.subject);
}

function groupAttempts(attempts: readonly ReportAttempt[]): ReportAttempt[][] {
  const groups = new Map<string, ReportAttempt[]>();
  for (const attempt of attempts) {
    const r = attempt.record;
    const key = JSON.stringify([
      r.agent,
      r.model,
      r.modelVerification,
      [...r.observedModels].sort(),
    ]);
    const group = groups.get(key) ?? [];
    group.push(attempt);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function rowsByFacet(text: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
    }
    if (ch === ")" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const expression = text.slice(start, i + 1);
        const match = /^\(\s*[a-z-]+\s+("(?:\\.|[^"\\])*")/.exec(expression);
        if (match) {
          try {
            const facet = JSON.parse(match[1]);
            const entries = rows.get(facet) ?? [];
            entries.push(expression);
            rows.set(facet, entries);
          } catch { /* Native ingest already validates the artifact. */ }
        }
        start = -1;
      }
    }
  }
  return rows;
}

function observed(record: AttemptRecord): string {
  return record.observedModels.length
    ? `${cell(record.observedModels.join(", "))} (${record.modelVerification})`
    : "unverified";
}
function cell(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function relativeLink(batchDir: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rel = relative(resolve(batchDir), resolve(value));
  return rel && rel !== ".." && !rel.startsWith(`..${sep}`) ? rel : null;
}

async function readFileIfPresent(
  path: string,
): Promise<{ path: string; text: string } | null> {
  try {
    return { path, text: await Deno.readTextFile(path) };
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return null;
    throw cause;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Deno.errors.NotFound) return false;
    throw cause;
  }
}
