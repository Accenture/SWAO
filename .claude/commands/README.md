# Claude Code slash commands -- SWAO project

Commands in this folder are loaded by Claude Code as `/name` slash commands
in sessions started against this repo. They encode repeatable team
workflows so both engineers (and their agents) do them the same way.

## Inventory

| Command | Purpose | When to run |
|---|---|---|
| `/pre-push` | Run the full pre-submit quality gate (`scripts/check-all.sh`) | Before `git push`, always |
| `/sprint-close` | Run the sprint-close checklist (demo, retro, next-sprint plan, AGENT.md reconciliation, policy-drift check) | Last day of each sprint |
| `/sprint-open` | Scaffold the next sprint plan document with carry-overs from the retro | Day 1 of each new sprint |
| `/new-adr` | Scaffold a new ADR at the next available NNNN with the template frontmatter | When an architectural decision needs capturing |
| `/lessons-learned` | Append a block to `docs/reports/lessons-learned.md` for cumulative team memory | Post-incident, post-release, or anytime a lesson emerges |
| `/policy-check` | Given a file or §N.M, list applicable policies from `docs/policies/MAPPING.md` | Before merging a PR touching policy-sensitive code |
| `/emdash-check` | Byte-accurate em-dash + en-dash scan across the repo | Before any PR, and as a sanity check after bulk edits |
| `/new-policy` | Scaffold a new policy markdown file from `docs/policies/_template/policy-template.md` | When capturing a new policy from OneNote / Confluence |

## Conventions

- Each command is a markdown file with YAML frontmatter (`name`, `description`, `argument-hint`, `allowed-tools`)
- The body is the prompt the agent reads when invoked
- Tool permissions declared in `allowed-tools` (only the tools the command
  actually needs; principle of least privilege)
- Commands do NOT make commits or pushes without human confirmation
- Commands that modify multiple files surface a summary and ask "proceed?"
  before writing

## Adding a new command

1. Pick a name (lowercase, hyphen-separated, action-oriented)
2. Copy an existing command as a starting point
3. Update frontmatter + body
4. Test with `/` in a Claude Code session
5. PR: `chore(commands): add /<name>`
6. Reviewer confirms: name is clear, scope is bounded, tool permissions
   are minimal

## Related

- `docs/design/team-collaboration.md` -- why we encode workflows as commands
- `docs/design/pre-submit-quality-gates.md` -- `/pre-push` context
- `docs/design/development-policy-workflow.md` -- `/policy-check` context
