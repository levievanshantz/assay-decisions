# Weekly Tester Check-in Template

Send to each tester at end of week, weeks 1-4.

---

**Subject:** Assay week N check-in (3 quick questions)

Hi <name>,

Week N of the Assay tester window. Three questions. Specific examples beat vibes — the answers go into the day-30 gate evaluation that decides whether the product scales or pivots.

### 1. Time saved

In the last 7 days, name **one specific moment** Assay gave you a cited answer in seconds that would otherwise have taken minutes of re-reading Notion/Slack/PRs.

- The query you ran: ___
- What Assay returned: ___
- Your estimate of minutes saved on this single moment: ___ min
- Did you act on it without re-verifying? Yes / No / Partially

If you can't name a moment this week, that's a valid answer — just say so.

### 2. Drift avoided

Did any `/assay-decision` surface a decision as superseded or in conflict — that you didn't realize was outdated?

- The query: ___
- The drift the system surfaced: ___
- What you would have done without that surface: ___

If no drift surfaced, also valid — say so.

### 3. Verdict trust

For the answers Assay gave you this week, did you act on them without re-verifying? Walk me through your reasoning:

- One example where you trusted it: ___
- One example where you re-verified (if any): ___ — what made you re-verify?

### Open question

Anything Assay should do that it doesn't, or does poorly? Be specific. "It's slow" doesn't help; "When I asked about pricing, the recall took 8 seconds and returned 5 decisions that weren't on-topic" helps a lot.

---

**Tagging stats from your machine** (for reference — operator pulls this; you don't need to):

```bash
# Operator runs this and includes the output in the check-in:
sqlite3 ~/.assay/decisions.db "SELECT COUNT(*) as total, COUNT(CASE WHEN kind='conflict' THEN 1 END) as conflicts, COUNT(CASE WHEN supersedes_resolved_id IS NOT NULL THEN 1 END) as supersessions FROM decisions"
wc -l ~/.assay/analytics/tool-usage.jsonl
```

Thanks. 10 minutes of your time changes our day-30 gate from sentiment to evidence.

— <operator>
