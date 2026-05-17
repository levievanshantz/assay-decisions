# Onboarding — Your First 30 Days With Assay

This is the operator's manual for the first 30 days. If you're a Builder PM testing Assay, follow this in order.

## Day 0 — Install (10 minutes)

```bash
# 1. Install the memory substrate (claude-mem v13+)
npx claude-mem install
npx claude-mem start

# 2. Clone + install Assay
git clone https://github.com/levievanshantz/assay-decisions
cd assay-decisions
npm install
npm run build
node bin/assay.mjs install

# 3. Verify
node bin/assay.mjs doctor
# Expect: 6/6 checks pass

# 4. (Optional but recommended) Run the proof
node bin/assay.mjs smoke         # 19 integration cases
node bin/assay.mjs eval          # 14 capability gates × 2 modes
node bin/assay.mjs demo          # end-to-end sandbox demo
```

**Restart Claude Code** (Cmd+Q on macOS, then relaunch). Claude Code discovers plugins on launch.

## Day 1 — Your first tag

In any Claude Code session, when you make a real decision worth remembering, tag it inline in your response (or ask Claude to tag it for you):

```
<assay-decision kind="decision" confidence="0.8" layer="pricing">
Price the Builder PM tier at $29/mo with no per-query quota. Differentiates
from Mem0's quota tiers; matches Lucas's "no friction at the tool-call
boundary" point from the March 19 call.
</assay-decision>
```

**End the session normally.** The Stop hook fires and persists the tag to `~/.assay/decisions.db`.

**Verify it landed:**
```bash
sqlite3 ~/.assay/decisions.db "SELECT id, kind, substr(body,1,60) FROM decisions ORDER BY created_at DESC LIMIT 5"
```

If you see your decision, capture works.

## Day 2-7 — Tagging discipline

Every time you make a real product/eng decision in an agent session, tag it. Don't tag conversational turns. Don't tag exploratory back-and-forth. Tag the **commits** — moments where you decide and would otherwise need to re-derive later.

**Good tags:**
```
<assay-decision kind="decision" confidence="0.7">
Move auth migration to v2.1 — keep v2.0 scope tight.
</assay-decision>

<assay-decision kind="decision" confidence="0.9" layer="positioning">
"Second brain for Builder PMs" — drop "for product teams" framing.
</assay-decision>
```

**Bad tags (don't do these):**
```
<assay-decision kind="decision">Talking to Lucas about pricing.</assay-decision>
<!-- ↑ this is a status update, not a decision -->

<assay-decision kind="decision">Yes, that sounds good.</assay-decision>
<!-- ↑ no concrete decision content -->
```

By end of week 1: 5-15 tags is healthy. <3 means you're not tagging enough (or not making decisions in agent sessions). >30 means you're tagging conversation, not decisions.

## Day 7 — First recall

In a new Claude Code session, ask:

```
/assay-decision what did we decide about pricing this week
```

Claude calls the MCP tool, gets cited decisions back, presents them. The response includes:
- The decision body (verbatim)
- Confidence + layer (if set)
- Supersession chain (if any)
- Enrichment context from claude-mem (when available)

**The trust contract:** if Assay tells you something, the citation lets you verify it's a real decision you made. Act on the verdict without re-derivation.

## Day 14 — First brief

When you want a synthesis (not raw recall):

```
/assay-brief AssayLabs pricing strategy
```

Returns a composed verdict + numbered citations. Every claim in the verdict traces to a specific decision in the citations list.

If the brief comes back as a refusal ("no decisions match topic"), that's the contract being honest — either the topic doesn't match anything you've tagged, or you need to use `/assay-decision` for raw recall instead.

## Day 21 — Supersession

You change your mind about a past decision. Look it up first:

```
/assay-decision pricing strategy
```

Note the 8-char prefix of the decision id (e.g., `a3f7c1d9`). Then in your next tag:

```
<assay-decision kind="decision" confidence="0.9" supersedes="a3f7c1d9" layer="pricing">
Revised: Builder PM tier moves to $49/mo. The $29 floor wasn't covering
inference cost at observed query volumes.
</assay-decision>
```

Next recall on "pricing" shows both decisions in the supersession chain — oldest first, newest last — with the audit trail preserved.

## Day 30 — Honest signal check

Three weekly questions you've been answering:

1. **Time saved this week:** name one moment Assay gave you a cited answer in seconds that would otherwise have taken minutes of re-reading. Estimate minutes saved.
2. **Drift avoided this week:** name one decision that surfaced as superseded or in conflict — that you didn't know was outdated. What would you have done without that surface?
3. **Verdict trust:** did you act on what Assay told you without re-verifying? Why / why not?

If by day 30 you can answer YES with specifics to 2 of 3 questions in most weeks → the value prop holds for you.

If you can't → the value prop doesn't hold for you specifically (or you didn't tag enough decisions to populate the corpus). Either way, tell us what didn't land.

## Troubleshooting

| Symptom | Check |
|---|---|
| Stop hook not firing | `tail -f ~/.assay/analytics/tool-usage.jsonl` while you end a session — should see entries with `tool:"stop-drain"` |
| `/assay-decision` returns nothing | `sqlite3 ~/.assay/decisions.db "SELECT COUNT(*) FROM decisions"` — if 0, hook isn't capturing |
| claude-mem worker not reachable | `npx claude-mem start && curl http://localhost:37701/api/health` |
| Want to start over | `rm ~/.assay/decisions.db && rm -rf ~/.claude/plugins/marketplaces/assaylabs/assay && node bin/assay.mjs install` |
| Want to silence Assay for one session | `ECC_HOOK_PROFILE=minimal claude` |
| Want to uninstall completely | `node bin/assay.mjs uninstall && rm -rf ~/.assay` |

## Eval gate as confidence anchor

If anything feels broken, run the eval gate before reporting a bug:
```bash
npm run eval
```

If 14/14 verify + 14/14 adversarial still pass, the system is honoring its contract — your symptom is either:
- A contract gap (the issue isn't covered by an eval — file a feature request)
- An environment issue (different from the eval sandbox — file a bug with `assay doctor` output)
- A misunderstanding of what Assay claims to do (re-read CAPABILITIES.md)
