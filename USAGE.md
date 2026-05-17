# Usage

## Tag attributes

```
<assay-decision
  kind="decision"           required: "decision" or "conflict"
  confidence="0.0..1.0"     optional: how sure you are
  supersedes="abc12345"     optional: 8-char prefix of prior decision id
  layer="pricing"           optional: freeform tag for organization
>
Decision body text. Multi-line OK. Markdown OK.
</assay-decision>
```

**Idempotency:** Duplicate tags (same kind + body) in the same transcript dedupe automatically. Tag once, capture once.

**Body discipline:** Make the body a complete decision statement, not a paraphrase. Future-you reading this should understand the decision without the surrounding context.

## Slash commands

### `/assay-decision <question>`
Recall decisions matching a natural-language question. Returns cited decisions with supersession chains.

```
You: /assay-decision what did we decide about auth migration
Claude: [calls assay_decision_recall, shows cited results]
```

### `/assay-brief <topic>`
Compose a verdict on a topic. Returns synthesized brief with citations OR refusal envelope if corpus is thin.

```
You: /assay-brief AssayLabs pricing strategy
Claude: [calls assay_brief_render, shows verdict + citations]
```

### `/assay-decision-deposit`
Tag a decision explicitly in the current response (vs. relying on agent to tag during work). Useful when:
- Running `ECC_HOOK_PROFILE=minimal` (ambient capture disabled)
- Retroactively capturing something that should have been tagged earlier

## Recipes

### Recipe 1: Capture during work
You're working through a problem with the agent. The agent proposes an approach. You agree. Just keep working — the agent will tag the decision as part of its response (assuming it knows to). Tag fires on Stop, persists to graph, done.

### Recipe 2: Recall before re-deriving
You hit a question you suspect you've answered before.
```
/assay-decision should we use Postgres or SQLite for v3
```
If the recall returns a prior decision with high confidence, act on it. If not, derive freshly and tag the result.

### Recipe 3: Brief at session start
First message of a new session, on a topic you've worked on before:
```
/assay-brief current state of the auth migration
```
Get a cited verdict back, start working from there instead of from zero.

### Recipe 4: Supersede a stale decision
You've decided to change a prior call.
```
/assay-decision pricing strategy
# (find the prior decision's id, copy the first 8 chars, e.g. "a3f7c1d9")

<assay-decision kind="decision" confidence="0.9" supersedes="a3f7c1d9" layer="pricing">
Revised: Builder PM tier moves to $49/mo. The $29 floor wasn't covering inference cost
at observed query volumes.
</assay-decision>
```
On next recall, the supersession chain will show both decisions in order, oldest first.

### Recipe 5: Flag a conflict
Two decisions you can't reconcile yet.
```
<assay-decision kind="conflict" layer="positioning">
Conflict: "Builder PM individual" framing (decision a3f7c1d9) vs "Product team SaaS"
framing (decision b8c2d5e0). Need to pick one before Day 30 gate.
</assay-decision>
```

## Output interpretation

### `context_tier` field
On recall responses:
- `"full"` — claude-mem reachable, enrichment included
- `"degraded"` — claude-mem reachable but slow OR mid-request error
- `"unavailable"` — claude-mem offline; only decision-graph data returned (cited but not enriched)

Treat decisions returned at any tier as authoritative. Only the **enrichment context** is affected by tier.

### `cold_start` field
On recall: corpus has <5 decisions. The system can't responsibly synthesize from that thin a base. Tag more decisions, recall again.

### `refusal` field
On brief: corpus search returned nothing relevant OR confidence was too low to compose. Don't paper over; fall back to `/assay-decision` for raw recall.

## Troubleshooting

### "Stop hook doesn't seem to fire"
1. `npx assay doctor` — check the plugin is installed.
2. Verify Claude Code was restarted after install.
3. Check `~/.assay/analytics/tool-usage.jsonl` — should have entries with `tool: "stop-drain"`.
4. Check `~/.assay/errors.jsonl` — tier-3 failures land here.

### "/assay-decision returns nothing"
1. Verify decisions are in the graph:
   ```bash
   sqlite3 ~/.assay/decisions.db "SELECT COUNT(*) FROM decisions"
   ```
2. If count is 0, the Stop hook isn't capturing. See above.
3. If count >5 but recall is empty, your query doesn't match — try a broader query.

### "claude-mem worker not reachable"
```bash
npx claude-mem start
curl http://localhost:37701/api/health
```

### "Recall is slow"
- Default: top-3 candidates get eagerly enriched via claude-mem.
- If you have many decisions, the recent-N retrieval is O(N); v3 will add vector similarity for the decisions table itself.

### "I want to start over"
```bash
rm ~/.assay/decisions.db
# Tags from future sessions will populate fresh.
```

### "I want to uninstall"
```bash
npx assay uninstall
# Then remove ~/.assay manually if you want to wipe data.
```
