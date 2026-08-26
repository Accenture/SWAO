---
name: lessons-learned
description: Append a lessons-learned entry to docs/reports/lessons-learned.md. Captures a specific thing we've learned so future sprints + new joiners don't relearn it.
argument-hint: <one-sentence lesson title>
allowed-tools: [Read, Edit, Write]
---

You are appending a lessons-learned entry for SWAO. Lessons-learned is the
team's cumulative institutional memory: things that surprised us, mistakes
we don't want to repeat, patterns we want to preserve.

## Step 1. Read the current lessons-learned log

Read `docs/reports/lessons-learned.md`. If it doesn't exist, create it with
this header:

```markdown
# SWAO lessons-learned log

Append-only. Every entry is a specific, actionable lesson the team learned
the hard way. New entries go at the top (most recent first) so readers
skim recent first.

Each entry follows the template in the first sub-section below; keep
entries short (< 200 words) and action-oriented.

## Template (copy this)

### YYYY-MM-DD -- <one-sentence lesson title>

**Context.** <What was happening when we learned this.>

**What we learned.** <The specific insight or pattern.>

**Why it matters.** <Why knowing this saves time / cost / correctness.>

**What we'll do differently.** <Concrete action, if any. Link to ADR,
spec change, or tooling update if that's where the lesson propagated.>

**Related.** <PR / issue / incident report / retro reference.>

---
```

## Step 2. Draft the new entry

Using the template, draft an entry with today's date and the lesson title
from $ARGUMENTS. Present the draft to the user. Ask:

- What's the context? (when / what happened)
- What's the specific insight?
- Why does it matter for future SWAO work?
- What do we change? (often: ADR update, spec edit, CLAUDE.md or AGENT.md
  amendment)
- Related PR / issue?

## Step 3. Capture user's answers

Fill in the draft. Keep each section terse (1-3 sentences max). No fluff.

## Step 4. Insert at top of log

Insert the new entry at the top of `docs/reports/lessons-learned.md`,
right after the "Template" section header, before any existing entries.

## Step 5. Propagation check

Ask the user: "Should this lesson propagate to:

- An ADR (new or amendment to existing)?
- AGENT.md (new invariant or do-not-do)?
- CLAUDE.md (new convention)?
- A design doc (component-specific behaviour)?
- The PR template (new gate)?
- The pre-push gate (new automated check)?"

If yes to any, create the propagation as a follow-up note (do NOT perform
the propagation in this command; that's a separate PR).

## Step 6. Summary

Report back:

1. Entry added: "YYYY-MM-DD -- <title>"
2. Word count: N (flag if > 200)
3. Propagation suggested: list the places
4. Next step: commit as `docs(reports): lessons-learned YYYY-MM-DD <title>`

Do NOT commit automatically; human commits after reviewing the phrasing.

## Examples of good lessons-learned entries

### Good: specific + actionable

> **Byte-accurate em-dash detection must use Python, not grep -P.**
> `grep -P '\xe2\x80\x94'` silently returns 0 on some grep builds, even
> when em-dashes are present. 190 em-dashes accumulated in SPEC.md before
> detection. Fix: use `python3 -c "open(p,'rb').read().count(chr(0x2014).encode())"`.
> Captured in `feedback_no_emdashes.md` memory + CLAUDE.md §5.1.

### Bad: vague

> **Review PRs more carefully.** Saw some bugs in PR review. Be more
> thorough.

(Too vague; not actionable; no evidence.)

### Bad: blame-oriented

> **Bob keeps forgetting to add tests.** Bob needs to add tests.

(Lessons-learned is about systemic insights, not individual blame. If
the system lets tests be skipped, fix the system.)
