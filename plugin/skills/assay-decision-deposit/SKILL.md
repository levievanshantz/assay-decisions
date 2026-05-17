---
name: assay-decision-deposit
description: Explicitly deposit a decision into the Assay decision graph, bypassing the Stop-hook ambient capture path. Use when the user says "remember this decision", "log that we decided X", "record this", or when working under ECC_HOOK_PROFILE=minimal where ambient capture is disabled. Also the right tool for retroactively capturing a decision made earlier in the session.
---

# /assay-decision-deposit — Explicit Decision Deposit

You are recording a decision into the Assay decision graph explicitly, rather than relying on the ambient Stop-hook drain.

## When to use

- User explicitly asks to "remember", "log", "record" a decision.
- User is running with `ECC_HOOK_PROFILE=minimal` (ambient capture disabled — they have to deposit manually).
- A decision was made earlier in this session and the Stop hook hasn't fired yet, but the user wants it persisted now.

## How to use

The MCP server does NOT expose a deposit tool yet (v2 ships recall-only via MCP). The deposit path is the Stop hook. To deposit explicitly:

1. **Inline tag in the current response** is the canonical mechanism:
   ```
   <assay-decision kind="decision" confidence="0.8">
   <verbatim decision text>
   </assay-decision>
   ```
2. When the session's Stop event fires, the hook will parse this tag and persist it.

For users who want immediate persistence (don't want to wait for Stop), they should:
- Use `/assay-decision <query>` afterward — recall to verify the tag was picked up.
- Or set `ECC_HOOK_PROFILE=strict` so the hook fires more aggressively.

## Tag attributes

- **`kind`** (required): `"decision"` for normal decisions, `"conflict"` when explicitly marking two prior decisions as conflicting
- **`confidence`** (optional): 0.0 to 1.0 confidence in the decision
- **`supersedes`** (optional): 8-char prefix of the decision ID this supersedes (use `/assay-decision` to find the ID first)
- **`layer`** (optional): freeform tag for organizing decisions (e.g., `"pricing"`, `"auth"`)

## Output style

When you inline an `<assay-decision>` tag, tell the user:
1. What you just tagged (the verbatim text)
2. That it will persist on the next Stop event (typically when this session ends)
3. How to verify via `/assay-decision`

## Don't

- Don't tag every conversational turn — only actual decisions.
- Don't paraphrase the user's decision into your own words inside the tag.
- Don't use `supersedes` without first looking up the prior decision via `/assay-decision`.
