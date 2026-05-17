# Contributing to Assay

Thanks for the interest. Assay is in v2.0-alpha — we're optimizing for tester signal, not contributor scale. The bar for accepted changes is **proven against the contract.**

## The contract

Every claim Assay makes lives in [`CAPABILITIES.md`](CAPABILITIES.md). Each capability has a claim, an acceptance criterion, an eval that verifies it, and listed adversarial vectors.

**Rule:** no PR ships without a clean eval gate. Run:

```bash
npm run eval   # 14 capabilities × 2 modes = 28 checks
```

If your change weakens any capability — or adds a feature that isn't covered by an eval — the PR doesn't land.

## What to work on

See [`ROADMAP.md`](ROADMAP.md). Each roadmap item has a trigger and a cost estimate. Pick something with the trigger met and we'll review.

**Especially welcome:**
- New adversarial probes for existing capabilities (extends the contract surface)
- Bug reports with reproduction via the eval harness
- Documentation that closes gaps testers actually hit

**Not currently welcome:**
- Net-new features not on the roadmap (open an issue first, we'll discuss)
- Drive-by refactors that don't address a capability gap

## Setup

```bash
git clone https://github.com/levievanshantz/assay-decisions
cd assay-decisions
npm install
npm run build
npm run smoke   # 19 integration cases
npm run eval    # full capability gate
```

You need:
- Node 22+
- macOS or Linux (Windows not supported in v2)
- For end-to-end testing: claude-mem v13+ (`npx claude-mem install && npx claude-mem start`)

## PR checklist

- [ ] `npm run smoke` passes (19/19)
- [ ] `npm run eval` passes (14/14 × 2 modes)
- [ ] If you added a capability: CAPABILITIES.md updated with claim + acceptance + adversarial vectors
- [ ] If you added a capability: eval written for it in `evals/capabilities/`
- [ ] If you changed a capability: existing eval still passes, OR you updated the eval AND CAPABILITIES.md acceptance line
- [ ] If you touched the Stop hook or MCP server: ran `npm run demo` and pasted the output in PR description
- [ ] If you touched the schema: provided a migration path (existing user DBs must still open)

## Cross-model eval (optional but encouraged)

For non-trivial changes, run the eval gate from a different AI's perspective:
```bash
# Codex example (requires `codex` CLI installed):
codex exec "cd $(pwd) && npm run eval" -s read-only
```
Compare against your local Claude/manual result. Cross-model agreement is a stronger signal than single-model self-assessment.

## Code style

- TypeScript strict mode, no `any` except at the IO boundary
- Explicit over clever
- Comments explain WHY (the non-obvious), not WHAT (the names should do that)
- No comments documenting recent changes — that belongs in the PR description

## Licensing

By contributing you agree your contributions are licensed under MIT.

## Code of Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
