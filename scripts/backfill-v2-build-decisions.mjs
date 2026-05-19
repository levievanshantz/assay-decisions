#!/usr/bin/env node
// Backfill: deposit the real decisions made during the v2 build into the
// live ~/.assay/decisions.db. Bootstraps the operator's corpus with
// audit-grade entries so recall has something real to chew on day 1.
//
// Idempotent: re-running is safe — dedupes by (kind, body) per the
// parser's existing dedupe logic.

import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStopDrain } from "../dist/hooks/stopDrain.js";
import { DecisionStore } from "../dist/decisions/store.js";

// 14 real decisions from the v2 build, faithfully reconstructed.
// Each gets ingested through the same Stop hook path a real PM would use.
const DECISIONS = [
  {
    kind: "decision", confidence: 0.85, layer: "architecture",
    body: "Build Assay v2 as a sidecar Claude Code plugin on top of claude-mem (memory primitive) and ECC (capture/lifecycle substrate). Zero fork; depends on claude-mem's public HTTP API. Why: sibling-architecture preserves claude-mem's update cadence without merge conflicts.",
  },
  {
    kind: "decision", confidence: 0.9, layer: "architecture",
    body: "Use the MemoryProvider interface (search/getObservations/health) as the abstraction over the memory substrate. ClaudeMemHTTPProvider is the v2 impl; QMDProvider is the v3 swap candidate. Why: lets us swap substrates without rewriting the decision layer.",
  },
  {
    kind: "decision", confidence: 0.95, layer: "architecture",
    body: "AssayLabs's Stop hook parses the raw transcriptPath directly rather than reading claude-mem's stored observations. Why: claude-mem strips memory tags before persistence — independence is non-negotiable for capture correctness.",
  },
  {
    kind: "decision", confidence: 0.8, layer: "schema",
    body: "Decision graph schema v1: typed decisions table + append-only decision_transitions + append-only decision_evidence. Append-only enforced at storage layer via SQLite BEFORE UPDATE/DELETE triggers, not just API absence. Why: trust contract requires storage-level guarantees, not just API discipline.",
  },
  {
    kind: "decision", confidence: 0.7, layer: "naming",
    body: "Repo name: assay-decisions (because levievanshantz/assay was a pre-existing archived repo). NPM scope: @assaylabs/assay. CLI binary: assay. Why: distinct GitHub slot; keeps npm + CLI brand-aligned.",
  },
  {
    kind: "decision", confidence: 0.9, layer: "positioning",
    body: 'Position Assay as "the second brain for Builder PMs" — individual users in Claude Code making product/eng decisions in agent loops. Explicitly NOT "for product teams" until a team uses it successfully. Why: matches the validated user shape we have (1 operator + planned 5 testers), avoids category collision with Membria.',
  },
  {
    kind: "decision", confidence: 0.85, layer: "methodology",
    body: 'DROP the "not the agent" anti-axiom from the strategy doc. AssayLabs CAN compose verdicts via assay_brief_render, not just return evidence packages. Why: Codex argued the axiom was unenforceable (verdict shaping happens via SessionStart payload anyway). Replaced with "synthesis is permitted; opacity is not."',
  },
  {
    kind: "decision", confidence: 0.9, layer: "validation",
    body: "Day-30 gate uses sliding ratio: ≥60% of active testers signal positive on ≥2/3 PM-behavioral questions. With 5 testers = 3/5; with 4 = 3/4. Why: robust to recruitment shortfall while preserving rigor. No usage thresholds (rejected as annoying per operator).",
  },
  {
    kind: "decision", confidence: 0.8, layer: "engineering",
    body: "Stop hook three-tier rescue: Tier 1 (SQLITE_BUSY, timeout) = retry with exponential backoff up to ~5s; Tier 2 (malformed XML, missing attr) = log + skip + continue; Tier 3 (disk full, schema mismatch) = errors.jsonl + stderr 'hook degraded'. Why: zero silent drops; every failure path observable.",
  },
  {
    kind: "decision", confidence: 0.9, layer: "engineering",
    body: "Pin claude-mem dependency to exact version (=13.2.0, not ^13). Plus postinstall version-check script that warns on drift. Why: stable validation window; we own the integration cadence, not Jordan's release schedule.",
  },
  {
    kind: "decision", confidence: 0.8, layer: "engineering",
    body: "assay_brief_render must filter by topic relevance — substring match against decision body + layer, with semantic fallback via provider.search(). Refuse if no matches. Why: Codex caught the prior behavior of composing recent decisions regardless of relevance — that breaks the trust contract.",
  },
  {
    kind: "decision", confidence: 0.85, layer: "engineering",
    body: "Eager fetch in recall caps at EAGER_FETCH_TOP_N=3 candidates. expand() does the wider fetch (limit=20) on demand. Why: contract says 'top-3 eager, 4-10 lazy' — prior implementation fetched 10 eagerly (wasteful) and only attached enrichment to top-3.",
  },
  {
    kind: "decision", confidence: 0.95, layer: "engineering",
    body: "assay install must call `claude mcp add` with absolute path, NOT rely on ${CLAUDE_PLUGIN_ROOT} resolution. Why: the env var resolves to whatever plugin context is active at registration time — causing the bug where assay's path resolved to ECC's directory on user's first restart.",
  },
  {
    kind: "decision", confidence: 0.9, layer: "validation",
    body: "Cross-model eval gate is required before human testing: 14 capabilities × 2 modes from BOTH Claude AND Codex. Round 1 caught 4 violations + 1 false positive; round 2 verified fixes; round 3 hardening pass scheduled. Why: single-model self-assessment is biased; cross-model agreement is the trust contract for the public README's badge claim.",
  },
];

async function main() {
  const sandbox = await mkdtemp(join(tmpdir(), "assay-backfill-"));
  console.log(`\nBackfilling ${DECISIONS.length} v2-build decisions into ~/.assay/decisions.db...\n`);

  const before = (() => {
    try {
      const s = new DecisionStore();
      const n = s.count();
      s.close();
      return n;
    } catch {
      return 0;
    }
  })();
  console.log(`  Before: ${before} decisions in graph`);

  const transcript = DECISIONS.map((d) => {
    const attrs = [
      `kind="${d.kind}"`,
      d.confidence !== undefined ? `confidence="${d.confidence}"` : null,
      d.layer ? `layer="${d.layer}"` : null,
    ].filter(Boolean).join(" ");
    return `<assay-decision ${attrs}>\n${d.body}\n</assay-decision>`;
  }).join("\n\n");

  const tpath = join(sandbox, "backfill-transcript.txt");
  await writeFile(tpath, transcript);

  const result = await runStopDrain({
    transcript_path: tpath,
    session_id: "v2-build-backfill-2026-05-19",
  });

  console.log(`  Stop hook result: ok=${result.ok} captured=${result.decisions_captured} parse_errors=${result.parse_errors ?? 0}`);

  const after = (() => {
    const s = new DecisionStore();
    const n = s.count();
    s.close();
    return n;
  })();
  console.log(`  After:  ${after} decisions in graph (+${after - before})`);

  await rm(sandbox, { recursive: true, force: true });

  if (!result.ok) {
    console.error(`\n  ✗ Backfill FAILED: ${result.reason}`);
    process.exit(1);
  }
  if (after - before === 0 && before === 0) {
    console.error(`\n  ✗ No decisions persisted and graph was empty — something is wrong.`);
    process.exit(1);
  }
  console.log(`\n  ✓ Backfill complete. Run /assay-decision in Claude Code to recall.\n`);
}

main().catch((err) => {
  console.error(`\nBackfill crashed: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
});
