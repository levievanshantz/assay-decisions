# Capabilities

**Iron-clad contract.** Every capability listed here has:
1. **Claim** — what the system promises to do
2. **Acceptance** — the binary pass/fail line
3. **Verify** — which eval in `evals/capabilities/` proves it
4. **Adversarial** — what an attacker would try to break the claim

This document is the source of truth for what Assay v2.0-alpha.2 ships. Anything not listed here is **not** a current capability. The roadmap lives in `ROADMAP.md`.

Version: `2.0.0-alpha.2`
Substrate: claude-mem v13.x (as MemoryProvider)
Lifecycle: Claude Code Stop hook (sidecar plugin)
Storage: SQLite at `~/.assay/decisions.db` (override via `ASSAY_DB_PATH`)

---

## C1 — Decision tag capture from agent transcripts

**Claim.** When `<assay-decision>...</assay-decision>` tags appear in an agent transcript, the Stop hook parses them and persists each decision as a typed row in `~/.assay/decisions.db`.

**Acceptance.**
- Given a transcript file with N valid `<assay-decision>` tags, after `runStopDrain({transcript_path})` returns, the decisions table contains exactly N new rows (modulo idempotency dedupe).
- Each row has: `id` (UUID), `kind` (`decision` or `conflict`), `body` (verbatim text), `status` (`tentative`), `confidence` (or null), `layer` (or null), `source_session_id`, `source_transcript_path`, `source_span_start`, `source_span_end`, `created_at`, `updated_at`.
- `decision_transitions` table has an `initial deposit` row for each new decision.

**Verify.** `evals/capabilities/c1-tag-capture.eval.mjs`

**Adversarial vectors.**
- Malformed XML (unclosed tag, escaped chars in body)
- Tag with no body (empty)
- Tag with unknown `kind` attribute
- Tag with invalid confidence value (string, out of range)
- Tag nested inside another tag
- Very large body (>100KB)
- Tag spanning multiple lines
- Unicode/emoji in body
- SQL-injection-shaped body content

---

## C2 — Idempotency on duplicate tags within a transcript

**Claim.** If the same decision appears multiple times in a single transcript (identical `kind` + `body`), only one row is persisted.

**Acceptance.**
- Given a transcript with the same `<assay-decision>` tag appearing 3 times, after `runStopDrain` returns, the decisions table contains exactly 1 row for that decision.
- The `parse_errors` count is 0.

**Verify.** `evals/capabilities/c2-idempotency.eval.mjs`

**Adversarial vectors.**
- Same body, different whitespace
- Same body, different kind
- Same body, different confidence (should this dedupe? Per implementation: kind+body only)
- Three duplicates and one variant

---

## C3 — Three-tier rescue: no silent drops on transient/recoverable/fatal errors

**Claim.** The Stop hook never silently drops decisions. Every failure class has explicit handling:
- **Tier 1 (transient):** `SQLITE_BUSY`, network timeout → retry with backoff (3 attempts, 100/200/300ms)
- **Tier 2 (recoverable):** malformed XML, missing required attr, `EACCES` on a single file → log to `~/.assay/analytics/tool-usage.jsonl` with `outcome='parse-failed'`, skip the offending unit, continue
- **Tier 3 (fatal):** disk full, schema mismatch, unrecoverable IO → log to `~/.assay/errors.jsonl` AND write `[assay] hook degraded: <msg>` to stderr

**Acceptance.**
- Tier 1: hook eventually succeeds after retries (verify via test that simulates SQLITE_BUSY).
- Tier 2: hook returns `ok: true` but logs parse error; offending tag absent from DB; other tags in same batch present.
- Tier 3: hook returns `ok: false`; `errors.jsonl` has an entry; stderr contains `[assay] hook degraded`.

**Verify.** `evals/capabilities/c3-rescue-tiers.eval.mjs`

**Adversarial vectors.**
- Force disk-full mid-transaction
- Lock the DB from another process
- Send malformed tags interleaved with valid tags (verify partial success)
- Provide a `transcriptPath` that doesn't exist

---

## C4 — Profile gating via ECC_HOOK_PROFILE

**Claim.** AssayLabs respects `ECC_HOOK_PROFILE` and `ECC_DISABLED_HOOKS` environment variables:
- `minimal` → Stop hook is a noop (returns OK without parsing or persisting)
- `standard` (default) → capture + parse + persist
- `strict` → capture + parse + persist + immediate stderr notification on `kind="conflict"` tags
- `ECC_DISABLED_HOOKS=stop:zz-assay-decision-drain` → Stop hook noops regardless of profile

**Acceptance.**
- Running with `ECC_HOOK_PROFILE=minimal`: zero decisions added to DB even with valid tags in transcript.
- Running with `ECC_HOOK_PROFILE=standard`: tags persisted normally.
- Running with `ECC_HOOK_PROFILE=strict`: conflict-kind tags emit stderr line; decisions persisted.
- Running with `ECC_DISABLED_HOOKS=stop:zz-assay-decision-drain`: noops even if profile would normally activate.

**Verify.** `evals/capabilities/c4-profile-gating.eval.mjs`

**Adversarial vectors.**
- Unknown profile value (should fall back to `standard`, not crash)
- Empty env var (should treat as unset → standard)
- Both `ECC_HOOK_PROFILE=strict` and `ECC_DISABLED_HOOKS=stop:zz-assay-decision-drain` set (disabled should win)

---

## C5 — Independent transcript parse (no dependency on claude-mem persistence)

**Claim.** AssayLabs reads the raw `transcriptPath` from hook input directly. It does NOT rely on claude-mem's stored observations to find `<assay-decision>` tags — because claude-mem strips memory tags before persistence.

**Acceptance.**
- With claude-mem worker OFFLINE: Stop hook still captures tags from transcript and persists to `~/.assay/decisions.db`.
- DB row count increases by N (number of valid tags) regardless of claude-mem reachability.

**Verify.** `evals/capabilities/c5-claude-mem-independence.eval.mjs`

**Adversarial vectors.**
- claude-mem worker on wrong port
- claude-mem returning 500
- claude-mem returning malformed responses

---

## C6 — MCP recall returns cited decisions with supersession chain

**Claim.** `assay_decision_recall(query)` returns a response with:
- `query` (echo of input)
- `results[]` — recent decisions, each with `decision` (full row) and `supersession_chain[]` (oldest first, max 10 hops, cycle-guarded)
- `context_tier`: `full` | `degraded` | `unavailable` depending on memory substrate state
- Optional `cold_start` envelope when corpus has <5 decisions

**Acceptance.**
- Corpus has ≥5 decisions: returns up to `limit` results ordered by `created_at` desc.
- Corpus has <5 decisions: returns `cold_start` envelope with `corpus_size` and explanatory message.
- Each result's `decision` field is a complete `StoredDecision` (all schema columns present).
- `supersession_chain` is non-empty for at least the result decision itself.
- `context_tier` reflects provider health at call time.

**Verify.** `evals/capabilities/c6-recall-shape.eval.mjs`

**Adversarial vectors.**
- Empty query string
- Extremely long query (10KB)
- Query containing tag-shaped content (`<assay-decision>`)
- Corpus with broken supersession (referenced ID missing)
- Corpus with supersession cycle (A→B→A)

---

## C7 — Graceful degrade when memory substrate is unavailable

**Claim.** If claude-mem is offline or returns errors, `assay_decision_recall` and `assay_brief_render` still return decision graph data. Only the enrichment context is affected.

**Acceptance.**
- With claude-mem worker stopped: recall returns decisions with `context_tier="unavailable"` and no enrichment.
- With claude-mem worker timing out mid-request: recall returns decisions with `context_tier="degraded"` and `context_tier_reason` populated.
- No exceptions propagated to caller.

**Verify.** `evals/capabilities/c7-graceful-degrade.eval.mjs`

**Adversarial vectors.**
- claude-mem worker process killed mid-fetch
- DNS failure (override worker URL to non-routable host)
- Worker returns HTTP 500
- Worker returns invalid JSON
- Worker returns valid JSON but missing expected fields

---

## C8 — Brief composition with citations (axiom-drop: synthesis allowed, opacity not)

**Claim.** `assay_brief_render(topic)` returns either:
- A `verdict` (composed synthesis from decision graph) + `citations[]` (every citation maps to a real decision ID), OR
- A `refusal` envelope with reason (corpus too thin, no relevant matches, or low confidence).

**Acceptance.**
- With corpus ≥5 decisions: returns non-empty `verdict` + `citations[]`; every `citation.decision_id` exists in the decisions table.
- With corpus <5 decisions: returns `refusal` with cold-start message.
- With corpus ≥5 but no relevant matches: returns `refusal` (current v2 implementation may need extension here; flag in adversarial run).
- `verdict` never contains uncited claims (current v2 prefixes each citation with `[N]` and verdict is the concatenated stitch).

**Verify.** `evals/capabilities/c8-brief-citations.eval.mjs`

**Adversarial vectors.**
- Empty topic
- Topic doesn't match any decision
- Topic matches but corpus is empty
- Citation `decision_id` doesn't exist in DB (this would be a contract violation)

---

## C9 — Storage isolation via ASSAY_DB_PATH

**Claim.** When `ASSAY_DB_PATH` environment variable is set, all reads and writes go to that path, NOT to `~/.assay/decisions.db`.

**Acceptance.**
- Setting `ASSAY_DB_PATH=/tmp/probe.db` before invoking the hook: decision lands in `/tmp/probe.db`.
- Real `~/.assay/decisions.db` row count is unchanged.
- Both `runStopDrain` and `DecisionStore` (constructed without explicit path) honor the env var.

**Verify.** `evals/capabilities/c9-storage-isolation.eval.mjs`

**Adversarial vectors.**
- `ASSAY_DB_PATH` points to a non-writable directory
- `ASSAY_DB_PATH` points to an existing valid SQLite file with different schema
- `ASSAY_DB_PATH` set but empty string (should treat as unset)
- `ASSAY_DB_PATH` set mid-process to a different path (should pick up on next `new DecisionStore()`)

---

## C10 — Append-only audit trail (decision_transitions)

**Claim.** Every state change to a decision (including initial deposit) writes an immutable row to `decision_transitions` with `decision_id`, `from_status`, `to_status`, `reason`, `transitioned_at`. No row is ever deleted from this table.

**Acceptance.**
- After depositing N decisions, `decision_transitions` has ≥N rows (one initial-deposit per).
- Each transition row references a valid `decision_id` (foreign key intact).
- Rows ordered by `transitioned_at` show the chronological history.

**Verify.** `evals/capabilities/c10-audit-trail.eval.mjs`

**Adversarial vectors.**
- Concurrent deposits from two processes (verify transitions still ordered correctly)
- Attempt to UPDATE a transition row (schema doesn't expose update path; verify no API allows it)

---

## C11 — Cycle-guarded supersession walk (max 10 hops)

**Claim.** `DecisionStore.supersessionChain(id)` walks the supersession graph forward from a decision, returning the chain oldest-first. The walk terminates on:
- Reaching a decision with no `supersedes_resolved_id`
- Detecting a cycle (revisiting an already-seen ID)
- Hitting the 10-hop cap

**Acceptance.**
- Linear chain (A → B → C → D): returns `[A, B, C, D]`.
- Cyclic chain (A → B → A): returns `[B, A]` (deduped, no infinite loop).
- Chain longer than 10 hops: returns first 10 entries, does not crash.
- Decision with no supersession: returns `[decision]`.

**Verify.** `evals/capabilities/c11-supersession-walk.eval.mjs`

**Adversarial vectors.**
- Pointer to non-existent decision (broken FK)
- Self-referential decision (A → A)
- Diamond pattern (A → B, A → C, both supersede X — only one path walked)

---

## C12 — Cold-start envelope at corpus size <5

**Claim.** When the decisions corpus has fewer than 5 rows, recall and brief return a structured `cold_start` envelope (or `refusal` for brief) explaining the threshold and how to populate.

**Acceptance.**
- Corpus has 0 decisions: cold_start present, `corpus_size: 0`.
- Corpus has 4 decisions: cold_start present, `corpus_size: 4`.
- Corpus has 5+ decisions: cold_start absent; normal results returned.

**Verify.** `evals/capabilities/c12-cold-start.eval.mjs`

**Adversarial vectors.**
- Corpus exactly at threshold (5)
- Corpus drops below threshold mid-call (race condition)

---

## C13 — Two-tier enrichment fetch (eager top-3, lazy 4-10)

**Claim.** `assay_decision_recall` eagerly batches enrichment for top-3 candidates via `MemoryProvider.getObservations()`. `assay_decision_expand` fetches enrichment for additional ranks on demand.

**Acceptance.**
- Recall returns top-N decisions; only the first 3 have `enrichment` populated (when provider is `full`).
- `expand(query, decision_ids)` fetches enrichment for those IDs and returns them in `expanded_results[]`.
- Both gracefully degrade when provider is unavailable.

**Verify.** `evals/capabilities/c13-two-tier-fetch.eval.mjs`

---

## C14 — Local-first, no quota, no API key

**Claim.** All core operations (capture, persistence, recall, brief) work entirely on the local machine without making any outbound network calls to vendor services. No API key required. No per-query rate limit.

**Acceptance.**
- Network interface offline: capture works (Stop hook completes successfully).
- Network interface offline: recall returns decisions (with `context_tier="unavailable"` since claude-mem worker localhost is reachable but its upstream embedding model may not be).
- No environment variable named `ANTHROPIC_API_KEY` (or similar) is required.
- 10,000 successive recall calls in a tight loop don't get rate-limited.

**Verify.** `evals/capabilities/c14-local-first.eval.mjs`

---

## Non-capabilities (explicit)

The following are **NOT** v2.0-alpha.2 features. Do not promise them. Do not test for them. See `ROADMAP.md` for what may come later.

- ❌ PM-shape decision tags (problem/hypothesis/metric/outcome)
- ❌ Multi-user / team mode
- ❌ Conflict resolution UI (conflicts surface as `kind="conflict"`, PM resolves manually)
- ❌ Vector similarity over the decisions table (recency-based ordering only in v2)
- ❌ QMD swap for memory substrate (claude-mem only in v2)
- ❌ Windows support (macOS + Linux only)
- ❌ SaaS hosting (single-user local SQLite only)
- ❌ Slack / Confluence connectors
- ❌ Web UI

---

## How to run the contract evals

```bash
# Verification mode: try to satisfy each capability, expect green
npm run eval:verify

# Adversarial mode: try to break each capability, expect green (no false positives)
npm run eval:adversarial

# Both modes back-to-back
npm run eval
```

Reports land in `evals/reports/<date>-<model>-<mode>.json`.

**Eval gate for human testing:** all 14 capabilities pass in BOTH modes, BOTH from Claude and from Codex independently. No capability gets a free pass.
