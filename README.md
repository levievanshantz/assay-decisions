# AssayLabs Decision Layer

**The second brain for Builder PMs.** Typed decision-graph judgment function for Claude Code, built on top of [claude-mem](https://github.com/thedotmack/claude-mem) as memory substrate.

Tag decisions inline while you work. Recall them with citations five seconds later. Compose briefs from accumulated evidence. Local-first, no vendor cloud, no quota.

## Why this exists

A Builder PM's agent loop produces team-scale output — PRDs, specs, evals, research — by week two. The personal corpus exceeds personal memory. Every new decision either repeats prior reasoning (slow) or skips the check (drift). Velocity without memory is a tax that scales with capability.

AssayLabs gives you a typed decision graph — what you decided, why it changed, what evidence backed it — synthesized from your own accumulated work in 5 seconds. So you ship faster with rigor instead of paying the velocity tax.

## How it works (60 seconds)

```
       You tag a decision           Recall it later
       in an agent session          in a new session
              │                            │
              ▼                            ▼
  ┌─────────────────────────┐    ┌──────────────────┐
  │  <assay-decision        │    │  /assay-decision │
  │   kind="decision"       │    │  "what did we    │
  │   confidence="0.8">     │    │   decide about   │
  │  Decision text body.    │    │   pricing"       │
  │  </assay-decision>      │    │                  │
  └────────────┬────────────┘    └────────┬─────────┘
               │                          │
               │  Stop event fires        │  MCP tool call
               │  (session ends)          │
               ▼                          ▼
  ┌─────────────────────────────────────────────────┐
  │  ~/.assay/decisions.db (SQLite, typed schema)   │
  │  ┌─────────────────────────────────────────┐    │
  │  │ decisions: id, kind, body, status,      │    │
  │  │   confidence, supersedes, layer, ...    │    │
  │  │ decision_transitions: audit trail       │    │
  │  │ decision_evidence: provenance links     │    │
  │  └─────────────────────────────────────────┘    │
  └────────────┬───────────────┬────────────────────┘
               │               │
               │               │  (when memory substrate available)
               │               ▼
               │   ┌────────────────────────────┐
               │   │  claude-mem (sibling)      │
               │   │  HTTP /api/search etc.     │
               │   │  ~/.claude-mem/...         │
               │   └────────────────────────────┘
               ▼
       Cited verdict with
       supersession chain
```

**Three Claude Code MCP tools:**

| Tool | What it does |
|---|---|
| `assay_decision_recall` | Find what was decided about a topic. Returns cited decisions + supersession chain + (when available) enrichment from session memory. |
| `assay_decision_expand` | Lazy-fetch enrichment for ranks 4-10 of a prior recall. |
| `assay_brief_render` | Compose a verdict on a topic from accumulated decisions. Cited synthesis. Refusal envelope when corpus is too thin. |

Plus three slash commands: `/assay-decision`, `/assay-brief`, `/assay-decision-deposit`.

## Install

```bash
# 1. Install the memory substrate (claude-mem)
npx claude-mem install
npx claude-mem start

# 2. Install AssayLabs
npx @assaylabs/assay install

# 3. Verify
npx @assaylabs/assay doctor

# 4. Restart Claude Code (Cmd+Q on macOS)
```

## Prove it works (before you trust it)

```bash
# Runs an isolated end-to-end demo in /tmp — doesn't touch your real data.
npx @assaylabs/assay demo

# Runs the 16+ case smoke pack
npx @assaylabs/assay smoke
```

The demo simulates an agent session with tagged decisions, fires the Stop hook, inspects the persisted graph, queries via MCP, and composes a brief. Output is human-readable proof.

## Use it

In any Claude Code session, when you make a decision worth remembering, tag it:

```
<assay-decision kind="decision" confidence="0.8">
Price the Builder PM tier at $29/mo with no per-query quota.
</assay-decision>
```

End the session. The Stop hook drains the tag into `~/.assay/decisions.db`.

In the next session:

```
/assay-decision what did we decide about pricing
```

The agent calls the MCP tool, gets back cited decisions, presents them to you.

For a synthesized brief:

```
/assay-brief AssayLabs pricing strategy
```

## What's in scope (and what isn't)

**v2.0 ships:**
- 3 MCP tools (recall, expand, brief)
- 3 slash commands
- Stop hook with three-tier rescue
- Typed decision graph (eng-shape)
- Cycle-guarded supersession walk
- Append-only audit trail
- Graceful degrade when claude-mem is offline
- Cold-start envelope for fresh corpora
- ECC profile gating (minimal | standard | strict)

**v2.0 does NOT ship (deferred):**
- PM-shape decision tags (problem/hypothesis/metric/outcome)
- Conflict resolution UI
- Team mode (multi-user)
- QMD swap-in for claude-mem retrieval
- Mobile/web UI

## Configure

| Env var | Effect |
|---|---|
| `ECC_HOOK_PROFILE=minimal` | Stop hook noops; deposit only via inline tags + explicit invocation |
| `ECC_HOOK_PROFILE=standard` (default) | Capture + parse + persist |
| `ECC_HOOK_PROFILE=strict` | + immediate stderr notification on conflict tags |
| `ECC_DISABLED_HOOKS=stop:zz-assay-decision-drain` | Disable AssayLabs's Stop hook entirely |
| `CLAUDE_MEM_WORKER_PORT=37701` | Override claude-mem worker port (default: `37700 + uid%100`) |
| `ASSAY_DB_PATH=/path/to/decisions.db` | Override decision DB location (default: `~/.assay/decisions.db`) |

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design rationale, including:
- Why a typed decision graph beats flat memory for this use case
- The "MemoryProvider" abstraction (swap claude-mem for QMD or roll-your-own in v3)
- "Not the agent" axiom drop and why composed verdicts with citations replace evidence-only output
- ECC + claude-mem + AssayLabs as sibling Claude Code plugins (sidecar, not fork)

## Usage details

See [USAGE.md](USAGE.md) for:
- Tag attribute reference
- Slash-command examples
- Recipes for common Builder PM workflows
- Troubleshooting

## Build from source

```bash
git clone https://github.com/levievanshantz/assaylabs-decision-layer
cd assaylabs-decision-layer
npm install
npm run build
npm run smoke    # 16 cases must pass
npm run demo     # end-to-end proof
```

## License

MIT. See [LICENSE](LICENSE).

## Credits

- [claude-mem](https://github.com/thedotmack/claude-mem) by Jordan Mocha — the memory substrate this rides on.
- [QMD](https://github.com/tobi/qmd) by Tobi Lütke — direct architectural inspiration for hybrid local-first retrieval; potential v3 substrate swap-in.
- Codex (OpenAI) — adversarial reviewer in the build loop.
