---
name: new-adr
description: Scaffold a new ADR with auto-assigned NNNN number, template frontmatter, and an open branch ready for editing.
argument-hint: <short-kebab-slug> (e.g., repo-topology-split)
allowed-tools: [Bash, Read, Write]
---

You are creating a new ADR for SWAO. Execute this workflow:

## Step 1. Determine the next ADR number

```bash
# Find the highest existing ADR number
ls docs/adr/ 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1
```

If no ADRs exist yet, start at `0001`. Otherwise, add 1 to the highest and
zero-pad to 4 digits.

**Exception:** ADRs 0001-0015 are reserved for §15.1 of SPEC.md (the
sprint-0-locked defaults). If $ARGUMENTS matches one of those reserved
slots, use the reserved number. Otherwise, the next available starts at
0016.

## Step 2. Create the feature branch

```bash
git checkout develop
git pull
git checkout -b adr/swao/NNNN-$ARGUMENTS
```

Where `NNNN` is the number from Step 1.

## Step 3. Scaffold the ADR file

Write `docs/adr/NNNN-$ARGUMENTS.md` with this content. Fill in the `title`
and leave the body sections as TODO markers:

```markdown
---
number: NNNN
title: "<one-sentence decision statement>"
date: YYYY-MM-DD  # today
status: proposed
deciders: [Helmut Schindlwick, Michael Plaschke]
supersedes: []
superseded_by: []
---

# ADR NNNN: <title>

## Context

<What prompted this decision. Constraints. Prior assumptions. Why now.>

## Decision

**We will <...>.**

<1-2 paragraphs expanding the decision.>

## Alternatives considered

### Alternative A: <name>

Description:
- <what it is>

Why rejected:
- <reason>

### Alternative B: <name>

Description:
- <what it is>

Why rejected:
- <reason>

## Consequences

### Positive

- <what becomes easier>

### Negative

- <what becomes harder>

### Neutral / trade-off

- <what we're accepting>

## Related

- SPEC.md §N.M -- <why>
- ADR-MMMM -- <supersession or dependency>
- docs/design/<name>.md -- <if relevant>

## Implementation notes

- <any concrete implementation guidance, if relevant at decision time>
```

## Step 4. Cross-reference

If this ADR affects any SPEC section, note which:

- If SPEC §15.1 needs an update (new entry in the reserved-ADRs table),
  flag it to the user: "SPEC.md §15.1 will need a PR to add this ADR to
  the reserved list"
- If an existing SPEC section needs to cite this ADR, flag which

Do NOT edit SPEC.md as part of this command; that's a separate PR so the
ADR ratifies first.

## Step 5. Summary

Report back:

1. ADR file created at `docs/adr/NNNN-$ARGUMENTS.md`
2. Branch created: `adr/swao/NNNN-$ARGUMENTS`
3. Status: `proposed`; needs the other engineer to accept via PR review
4. Cross-reference updates needed (if any): list them

Ask the user to fill in the Context + Decision + Alternatives sections.
The rest of the workflow is:

```
# After filling in the content
git add docs/adr/NNNN-$ARGUMENTS.md
git commit -m "adr(NNNN): <title>"
git push -u origin adr/swao/NNNN-$ARGUMENTS
gh pr create --base develop --fill
```

Do NOT attempt the commit or push yourself. Those are human-authored after
the content is written.
