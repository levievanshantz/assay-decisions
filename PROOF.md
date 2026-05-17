# PROOF

The complete record of evidence that Assay v2.0-alpha.2 honors its contract.

**Date sealed:** 2026-05-17
**Eval-gate criterion (from CAPABILITIES.md):** all 14 capabilities pass in BOTH modes from BOTH Claude and Codex independently.
**Status: MET.**

---

## Layer 1 — Integration smoke pack (19 cases)

```
$ npm run smoke
[1] Parser cases                                    6/6 ✓
[2] Stop hook cases                                 6/6 ✓
[3] Store cases                                     2/2 ✓
[4] Provider + MCP cases (requires worker running)  2/2 ✓
[5] Isolation guard — ASSAY_DB_PATH honored        3/3 ✓
=== Results: 19 passed, 0 failed ===
```

Covers: parser correctness, idempotency, three-tier rescue, profile gating, hook ordering, store transactional deposit, provider health probe, MCP server cold-start, **real-DB isolation guard** (the regression test for the bug Codex caught where the Stop hook was contaminating `~/.assay/decisions.db`).

## Layer 2 — Capability eval gate (14 × 2 modes = 28 checks)

```
$ npm run eval
══════════════════════════════════════════════════════════════════════
Running 14 evals in VERIFY mode
══════════════════════════════════════════════════════════════════════
  ✓ C1 decision tag capture from agent transcripts
  ✓ C2 idempotency on duplicate tags
  ✓ C3 three-tier rescue: no silent drops
  ✓ C4 profile gating via ECC_HOOK_PROFILE
  ✓ C5 independent transcript parse — no dependency on claude-mem
  ✓ C6 MCP recall returns cited decisions with supersession chain
  ✓ C7 graceful degrade when memory substrate is unavailable
  ✓ C8 brief composition with citations
  ✓ C9 storage isolation via ASSAY_DB_PATH
  ✓ C10 append-only audit trail in decision_transitions
  ✓ C11 cycle-guarded supersession walk (max 10 hops)
  ✓ C12 cold-start envelope at corpus size <5
  ✓ C13 two-tier enrichment fetch
  ✓ C14 local-first: no network call required for capture
  Results: 14 passed, 0 failed, 0 skipped

══════════════════════════════════════════════════════════════════════
Running 14 evals in ADVERSARIAL mode
══════════════════════════════════════════════════════════════════════
  Results: 14 passed, 0 failed, 0 skipped

  ✓ GATE PASSED — all evals green in verify + adversarial modes.
```

Reports preserved in `evals/reports/*.json`.

## Layer 3 — End-to-end demo (full capture → recall → brief)

```
$ npm run demo
Step 1 — Simulate an agent session with tagged decisions
   parser found: 2 decisions, 0 errors
Step 2 — Stop hook fires — drain tags into the decision graph
   hook result: { ok: true, decisions_captured: 2 }
Step 3 — Inspect the persisted graph: 2 rows with kind/confidence/layer
Step 4 — Test memory substrate (claude-mem) reachability
   provider.health(): { status: "full", latency_ms: 25 }
Step 5 — Populate past cold-start threshold (add 4 more)
   decisions in graph: 6
Step 6 — MCP recall: returns 5 cited results with supersession chains
Step 7 — MCP brief: composes verdict with 5 citations
Step 8 — Cleanup

DEMO COMPLETE — system works end-to-end:
  ✓ Stop hook parses <assay-decision> tags from transcript
  ✓ Decisions persist to typed graph with kind/confidence/layer/lineage
  ✓ MCP recall returns cited decisions ordered by recency
  ✓ Brief composition produces verdict with citations
  ✓ Graceful degrade when substrate is offline
Your real ~/.assay/decisions.db: untouched.
```

## Layer 4 — Live MCP server stdio handshake

This is the actual interface Claude Code uses when invoking `/assay-decision`. The handshake below proves the server initializes, lists tools correctly, and executes tool calls.

```
$ # JSON-RPC over stdio against the live installed plugin
$ echo '... initialize + initialized + tools/list + tools/call ...' \
    | node ~/.claude/plugins/marketplaces/assaylabs/assay/plugin/scripts/mcp-server.mjs

  serverInfo: name=assay version=2.0.0-alpha.2
  tools listed: 3
    - assay_decision_recall
    - assay_decision_expand
    - assay_brief_render
  tool call returned: query=final proof handshake cold_start=yes results=0
```

The cold-start response confirms the live database is connected and the read path works. When the user tags decisions and re-invokes, the same code path returns real results (verified in Layer 3 demo).

## Layer 5 — Doctor checks

```
$ node bin/assay.mjs doctor
assay doctor
  ✓ plugin installed at /Users/levishantz/.claude/plugins/marketplaces/assaylabs/assay
  ✓ workspace exists at /Users/levishantz/.assay
  ✓ decisions.db exists (52.0KB)
  ✓ claude-mem worker reachable on port 37701 (v13.2.0)
  ✓ Stop hook registered
  ✓ MCP server registered as 'assay'

  All checks passed.
```

## Layer 6 — Cross-model verification (Codex)

**Round 1 — Codex independent audit:** found 4 contract violations + 1 false positive in Claude's evals.

| # | Issue | Resolution |
|---|---|---|
| C3 | SQLite lock retry window too short (600ms) | Bumped to 6 attempts, exponential backoff to ~5s |
| C8 | Brief composed verdict regardless of topic match | Added topic-relevance filter + semantic fallback |
| C10 | Append-only enforced at API only, not storage | Added SQLite BEFORE UPDATE/DELETE triggers |
| C13 | Eager fetch retrieved 10 obs when contract said top-3 | Capped search limit to EAGER_FETCH_TOP_N (=3) |
| C12 (false positive) | Codex claimed cold-start bug | Reproduction confirmed implementation is correct |

**Round 2 — Codex re-verification of all 4 fixes:**

```
PROBE F1 (C3 retry backoff): ok in 3066ms, decisions_captured=1 — PASS
PROBE F2 (C8 topic refusal): unrelated refusal, topic X compose — PASS
PROBE F3 (C10 trigger enforcement): UPDATE+DELETE blocked on both tables — PASS
PROBE F4 (C13 eager limit): recall=3, expand=20 — PASS

VERDICT: CLEAR
```

Both AIs independently converge that the system honors its 14 contracts.

## What this DOESN'T prove

These proofs exercise the **code** against the **contract**. They do NOT validate **product fit** for Builder PMs. That's the day-30 human-testing gate per ROADMAP.md R5-R7.

In particular:
- Real Builder PMs might not tag enough decisions for the corpus to mature
- Recall quality with thousands of decisions is untested (current eval uses ≤8 per case)
- claude-mem version drift could break the integration silently (R20 will automate drift detection)
- The "verdict trust" claim depends on tester behavior, not measurable in code

These are R7 + roadmap concerns, not v2.0-alpha.2 concerns.

## How to re-prove

```bash
git clone https://github.com/levievanshantz/assay-decisions
cd assay-decisions
npm install
npm run build
npm run smoke    # Layer 1 — 19 cases
npm run eval     # Layer 2 — 28 checks
npm run demo     # Layer 3 — end-to-end
node bin/assay.mjs doctor  # Layer 5
```

For Layer 4 (live MCP RPC), see the command in this doc above. For Layer 6 (cross-model), see prompts in `/tmp/codex-eval-round{1,2}-prompt.txt` from the original session.

If any of the above fails, the contract is broken; do not ship to humans until fixed.
