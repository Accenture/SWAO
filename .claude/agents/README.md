# Claude Code subagents -- SWAO project

Specialised agents defined in this folder run in isolated contexts when
invoked via the Task tool. Different from slash commands: slash commands
run in the main session; subagents get their own context window, tool
allowlist, and system prompt.

## When to use a subagent vs a slash command

| Use subagent when | Use slash command when |
|---|---|
| Task runs in parallel (e.g., review 6 PRs concurrently) | Task is sequential + benefits from main-session history |
| Task produces long tool output (scanner results, full file reads, big test logs) that would pollute main context | Task is mostly templating / scaffolding / orchestration |
| Task benefits from a specialised system prompt (reviewer vs builder mindset) | Task needs the main session's accumulated context |
| Task has different tool-permission needs than the main session | Task benefits from interactive human confirmation mid-flow |
| Task is research-heavy (read many files, synthesise findings) | Task writes a few files from a template |

Rough rule: **if the task is an investigation, use a subagent; if it's
a recipe, use a slash command.**

## Inventory

| Subagent | Purpose | Typical invoker |
|---|---|---|
| `swao-reviewer` | Review a PR diff against SPEC.md + AGENT.md conventions; produce structured findings | Main session, by the PR author or the reviewer |
| `sprint-retro-drafter` | Read git log + closed issues + merged PRs; draft `docs/reports/sprint-NNN-retro.md` | `/sprint-close` slash command |
| `deploy-orchestrator` | Execute `scripts/staging-rc.sh` + `scripts/publish-release.sh` with long-running Docker builds, Trivy scans, publish calls; protect main context | Human-initiated at sprint close |
| `policy-reviewer` | Given a PR diff, identify applicable policies from `docs/policies/MAPPING.md` and check each against the changed code | Main session when policy-sensitive PRs open |
| `test-designer` | Given a new feature or bug description, propose test coverage at each layer (unit/contract/integration/E2E) | Sprint planning + feature-design time |

## Conventions

- Each subagent is a markdown file with YAML frontmatter (`name`, `description`, `tools`)
- `tools` declares the minimum tool set the subagent needs (principle of least privilege)
- Body is the system prompt; structured with role + responsibilities + output shape + do-not-do list
- Subagents NEVER commit or push; they produce artefacts for human review
- Subagents NEVER modify SPEC.md, CLAUDE.md, or AGENT.md without human-approved ADR
- Subagents cite evidence (file:line, §N.M) same as the main session

## Adding a new subagent

1. Pick a name (lowercase, hyphen-separated, noun-ish: `thing-doer`)
2. Copy an existing subagent as starting point
3. Tighten the `tools` list to minimum necessary
4. PR: `chore(agents): add swao-<name>`
5. Reviewer confirms: scope is bounded, tool permissions are minimal,
   output shape is specified

## Related

- `.claude/commands/` -- the slash-command inventory (complementary to this)
- `docs/design/team-collaboration.md` §5 -- Claude Code as team member
- `CLAUDE.md` §6 -- agent delegation rules
