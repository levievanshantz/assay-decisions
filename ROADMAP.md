# Roadmap

What's remaining after v2.0-alpha.2. Each item has a trigger (what causes it to enter scope) and a cost estimate (CC + human).

Current version: `2.0.0-alpha.2`
Status: hand-off candidate, pending eval-gate clearance + human testing.

---

## Pre-human-testing (must-do before alpha.3 ships to anyone)

### R1 — Pass the eval gate
**Trigger:** before any non-operator human installs.
**Spec:** all 14 capabilities in `CAPABILITIES.md` pass in BOTH verify and adversarial modes from BOTH Claude and Codex.
**Cost:** 2-4 hours CC; instant if first run green, multi-iteration if not.
**Owner:** automated via `npm run eval`.

### R2 — Publish to GitHub
**Trigger:** eval gate green.
**Spec:** `gh repo create assaylabs/assay --public --source=. --push`. Tag the alpha.2 commit.
**Cost:** 5 min human.

### R3 — Add CONTRIBUTING.md + CODE_OF_CONDUCT.md
**Trigger:** before opening to external contributors.
**Spec:** standard MIT-licensed OSS contributing guide. Issue templates for bug reports and feature requests.
**Cost:** 30 min CC.

### R4 — Add minimal CI
**Trigger:** before any external PR.
**Spec:** GitHub Actions workflow: build → smoke → eval (in verify mode only — adversarial too slow for CI).
**Cost:** 1 hour CC.

---

## Human-testing phase (alpha.3 → beta.1)

### R5 — Tester onboarding pack
**Trigger:** R1+R2 green.
**Spec:**
- `docs/onboarding.md` — what to install, what to expect day 1/7/30
- `docs/tagging-guide.md` — examples of good vs bad `<assay-decision>` bodies
- Weekly check-in template (the 3 PM-behavioral questions from the v2 plan §3)
**Cost:** 1 hour CC.

### R6 — Recruit 4 testers (5 total with operator)
**Trigger:** R5 ready.
**Spec:** outreach list of 10 named Builder PMs at Shopify/Coinbase/Opendoor/Ramp shape; 4 commit to 30-day trial.
**Cost:** 1-2 hr/day human for 7-10 days.

### R7 — Day-30 gate evaluation
**Trigger:** R6 testers active for 30 days.
**Spec:** sliding ratio gate from v2 plan §3 — 60% of active testers positive on ≥2/3 PM-behavioral questions.
**Outcomes:**
- ≥3/5 positive → proceed to beta.1, simplify codebase per v2 plan §4
- <3/5 → ship integration recipe, deprecate the layer (no special tester transition per CEO T6)

---

## Capability extensions (beta.1+, conditional on R7 green)

### R8 — Vector similarity for decision-graph recall
**Trigger:** any tester says "recall doesn't find the right decision" with a specific example.
**Spec:** embed decision bodies on insert (bge-large or claude-mem's embedding pipeline). Replace recency-based `DecisionStore.recent()` with vector-similarity sweep.
**Cost:** 1 day CC.
**Risk:** doubles `decisions.db` size; needs migration for existing rows.

### R9 — Real verdict synthesis (replace stitched-citation prefix)
**Trigger:** any tester says "the brief is too literal — it just lists decisions."
**Spec:** add an LLM call in `assay_brief_render` that composes a real narrative verdict from the citation evidence. Use Claude Code's available context (no API key — the calling agent is the LLM).
**Cost:** 1 day CC.
**Risk:** verdict opacity if not careful. Mitigation: enforce citation-per-claim in the prompt.

### R10 — Conflict resolution UI
**Trigger:** any tester deposits a `kind="conflict"` tag.
**Spec:** new MCP tool `assay_conflict_resolve(decision_a, decision_b, winner, reason)`. Updates both decisions' statuses, writes audit trail.
**Cost:** 1 day CC.

### R11 — PM-shape decision tags
**Trigger:** any PM tester explicitly asks for problem/hypothesis/metric/outcome fields.
**Spec:** migration 002 adding `pm_problem`, `pm_hypothesis`, `pm_metric`, `pm_outcome` columns. Parser handles `kind="pm"` shape. Tag attribute: `<assay-decision kind="pm" problem="..." hypothesis="..." metric="..." outcome="pending">`.
**Cost:** 2 days CC.

### R12 — QMD swap-in for memory substrate
**Trigger:** ANY of:
- a tester explicitly says "claude-mem retrieval quality is bad"
- claude-mem ships a breaking change that's painful to track
- Tobi accepts upstream PR that adds the integration we need
**Spec:** new `QMDProvider` implementing `MemoryProvider` interface. Contract test (`tests/MemoryProvider.contract.ts`) ensures swap-compatibility. Migration script for existing observations.
**Cost:** 1 week CC.

---

## Distribution (after R7 green)

### R13 — Claude Code plugin marketplace listing
**Trigger:** R7 green; R2 published.
**Spec:** `claude plugin marketplace add assaylabs/assay`. Hand off install command to public docs.
**Cost:** 30 min once Claude Code's marketplace UX accepts the listing.

### R14 — npm publish
**Trigger:** R7 green.
**Spec:** `npm publish --access public` for `@assaylabs/assay`.
**Cost:** 15 min once npm scoped-org access is set up.

### R15 — Landing page
**Trigger:** R7 green; first non-tester user wants to install.
**Spec:** single-page marketing site at assaylabs.io/assay with the 60-second demo from README, install command, link to repo. Reuse existing assaylabs-docs-site repo on Vercel.
**Cost:** half day CC + 1 hour design polish.

---

## Future-future (beta.2+, after PMF signal)

### R16 — Team tier (multi-user on Postgres + pgvector)
**Trigger:** ≥1 team paying for the local-first tier AND requests shared decision corpus.
**Spec:** Postgres + pgvector adapter implementing `MemoryProvider`. `~/.assay/decisions.db` becomes user's local cache; team source-of-truth is in Postgres. Sync strategy: append-only, decisions immutable, supersessions append new rows.
**Cost:** 2 weeks human; depends on R12 done.

### R17 — Conflict-resolution UI (web)
**Trigger:** R16 in motion.
**Spec:** small Next.js admin UI for browsing decisions, walking supersession chains, resolving conflicts collaboratively.
**Cost:** 1 week CC.

### R18 — Windows support
**Trigger:** ≥1 named Windows tester asks.
**Spec:** path handling fixes, install script Windows variant, CI matrix expansion. better-sqlite3 already cross-platform.
**Cost:** 2 days CC.

### R19 — Slack / Confluence connectors
**Trigger:** ≥1 team tester explicitly asks.
**Spec:** ingestion adapters that scrape decisions from existing Slack threads / Confluence pages with `<assay-decision>` markers. Currently only Notion + local markdown are in scope.
**Cost:** 1 week CC per connector.

---

## Operational

### R20 — Drift-detection automation
**Trigger:** CAPABILITIES.md or ARCHITECTURE.md drifts from code reality (auto-detect via weekly job).
**Spec:** GitHub Action that runs a Sonnet sub-agent to compare CAPABILITIES.md claims against `npm run eval` results. Opens an issue if drift detected.
**Cost:** 2 hours CC.

### R21 — Tool-count consistency CI gate
**Trigger:** v2.1.
**Spec:** CI fails if MCP server's `ListTools` registered count ≠ count in README/CAPABILITIES.
**Cost:** 1 hour CC.

### R22 — `assay doctor --replay` weekly cron
**Trigger:** any tester reports unexplained behavior.
**Spec:** scheduled local script that walks the decision graph and asserts 5 invariants (citations link to real decisions, supersession FKs resolve, audit trail complete, no orphan rows, schema version matches).
**Cost:** 4 hours CC.

---

## Killed / Deferred indefinitely

### K1 — "Not the agent" axiom
**Killed:** 2026-05-17 per CEO review T1 (Codex argued unenforceable, user accepted axiom drop).
**Replaced with:** "synthesis is permitted; opacity is not."

### K2 — Three-tier Postgres deferred design
**Killed for v2:** plan §5 deletion list. Was speculative.
**Revisit:** R16 trigger.

### K3 — "For product teams" marketing positioning
**Killed:** 2026-05-17 per CEO review F8. Was aspirational, not validated.
**Replaced with:** "Second brain for Builder PMs (individual)."
**Revisit:** post-R16, post-team-validation.

---

## Decision log (signed)

Every roadmap mutation should be logged as an inline `<assay-decision>` tag in the session that triggers it. Eat dog food on roadmap changes. The roadmap is itself a corpus of decisions.

```
<assay-decision kind="decision" confidence="0.9" layer="roadmap">
Add R8 (vector similarity) to roadmap because tester #2 reported recall miss
on "auth migration" query — recency wasn't enough.
</assay-decision>
```
