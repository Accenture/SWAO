---
name: sprint-close
description: Run the sprint-close checklist: demo prep, retro drafting, next-sprint backlog, AGENT.md reconciliation, policy-drift check, lessons-learned capture.
argument-hint: <sprint-number>
allowed-tools: [Bash, Read, Write, Edit, Grep]
---

You are closing sprint $ARGUMENTS. Execute the sprint-close workflow step
by step. Do NOT commit or push anything without explicit human confirmation.

Follow this sequence; after each step, summarise what was done and wait for
"proceed" before continuing to the next:

## Step 1. Sprint state audit

- Read `docs/sprint-planning/sprint-$ARGUMENTS.md` (the plan for this sprint)
- Run `git log --oneline --since="2 weeks ago" main..develop` to list commits
- List issues in `docs/tracker/issues/closed/` whose frontmatter `milestone`
  matches this sprint
- List issues still in `docs/tracker/issues/open/` that were committed to
  this sprint but not closed (carry-overs)
- Surface: what shipped vs what slipped

## Step 2. Draft the retro

Create `docs/reports/sprint-$ARGUMENTS-retro.md` using this shape. Fill in
from Step 1 evidence; leave TODO markers where the two engineers need to
add subjective input:

```markdown
# Sprint $ARGUMENTS retrospective

Closed: YYYY-MM-DD
Duration: 2 weeks
Engineers: [helmut, colleague]

## What shipped

<from step 1 closed issues list + PR titles>

## What slipped

<carry-overs with reasons>

## Metrics

- Issues closed: N
- PRs merged: N
- Sprint velocity vs commit: P%
- CI green rate: P%
- Review SLA compliance (<24h): P%

## What worked (TODO: both engineers add)

-

## What didn't (TODO: both engineers add)

-

## Changes for next sprint (TODO: decide jointly)

-

## AGENT.md reconciliation

- Agent behaviour drift observed: <none | describe>
- AGENT.md updates needed: <none | list>

## Policy drift check

- Policies overdue for verification: <run policy-drift scan>
- Action: <re-verify / re-capture / accept>

## Lessons learned (propagate to lessons-learned.md)

-
```

## Step 3. AGENT.md reconciliation

- Read current `AGENT.md`
- Ask: "Did the agent this sprint do anything AGENT.md doesn't document?
  Any rules violated? Any new conventions that emerged?"
- Capture updates in the retro's "AGENT.md reconciliation" block
- If non-trivial updates: plan an `AGENT.md` PR for next sprint

## Step 4. Policy-drift check

- Read every policy file under `docs/policies/`
- For each: check `last_verified` against `review_cadence`; flag overdue
  entries
- Append list to the retro's "Policy drift check" block
- Suggest: which policies to re-capture in next sprint

## Step 5. Lessons-learned append

- Identify 1-3 lessons worth propagating (from incidents, near-misses,
  surprising insights)
- Use the `/lessons-learned` command to append each to
  `docs/reports/lessons-learned.md`

## Step 6. Next-sprint scaffold

- Determine next sprint number: N+1 where N=$ARGUMENTS
- Run `/sprint-open <N+1>` to scaffold the next sprint plan with
  carry-overs from Step 1 pre-filled

## Step 7. Final summary

Report back:

1. Retro file created at `docs/reports/sprint-$ARGUMENTS-retro.md`
2. Lessons-learned entries appended: N
3. Policies flagged overdue: N
4. AGENT.md updates needed: yes/no
5. Next sprint scaffolded: sprint-<N+1>.md

Ask the user to review the retro before it gets committed.
