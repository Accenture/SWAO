// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     AI-accelerated cloud workload compliance assessment
//
//     Community Edition  --  Apache 2.0  --  Contributing Guide
//
//     Website       :  https://steady-echo-yp4z.here.now
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================

# Contributing to SWAO

Thank you for your interest in contributing to SWAO (Software Workload Assessment Optimiser). SWAO is an open-source tool that helps organisations assess cloud migration readiness using structured compliance frameworks. Community contributions -- from bug reports and feature ideas to new compliance frameworks -- make it better for everyone.

## Before You Start

To avoid duplicated effort, please **open a Discussion before filing an issue** for anything non-trivial:

<https://github.com/Accenture/SWAO/discussions>

This applies especially to: new features, new frameworks, significant refactors, and questions about project direction. For straightforward bug reports, you can go straight to the issue tracker.

## Framework Contributions

Adding a compliance framework is the single most impactful contribution you can make. **No TypeScript knowledge is required** -- frameworks are defined entirely in YAML.

Each framework lives in its own directory and requires two files:

- **`framework-meta.yaml`** -- framework identity, version, standard body, and top-level metadata
- **`controls.yaml`** -- the full list of controls, each with an ID, title, description, and mapping hints

Start by opening a [framework contribution issue](https://github.com/Accenture/SWAO/issues/new?template=framework-contribution.md) so maintainers can confirm the framework is in scope before you invest time writing the YAML.

## Bug Reports and Features

Use the issue templates to keep reports consistent and actionable:

- **Bug report**: <https://github.com/Accenture/SWAO/issues/new?template=bug-report.md>
- **Feature request**: <https://github.com/Accenture/SWAO/issues/new?template=feature-request.md>

## Local Development Setup

The following steps set up the Community Edition locally:

```bash
# 1. Clone the repository
git clone https://github.com/Accenture/SWAO.git
cd SWAO

# 2. Install dependencies (pnpm is required)
pnpm install

# 3. Build the community package
pnpm build

# 4. Run the test suite
pnpm test
```

Requires Node.js 20+ and pnpm 9+.

## Commit Message Conventions

SWAO follows [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must start with a type prefix:

| Prefix  | When to use                                    |
|---------|------------------------------------------------|
| `feat:` | A new feature or framework                     |
| `fix:`  | A bug fix                                      |
| `docs:` | Documentation-only changes                     |
| `chore:`| Build, config, or maintenance tasks            |

Examples:

```
feat(frameworks): add NIST SP 800-53 Rev 5 controls
fix(cli): correct control count in summary output
docs: update local setup instructions
chore: bump markdownlint-cli2-action to v16
```

## PR Checklist

Before submitting a pull request, confirm all of the following:

- [ ] No em-dashes (`--`) or en-dashes in any prose or Markdown
- [ ] All prose uses British English spelling (behaviour, licence, organisation, etc.)
- [ ] `pnpm test` passes locally
- [ ] Documentation updated where relevant
- [ ] Commit messages follow Conventional Commits

## Community Standards

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to a welcoming, inclusive, and harassment-free community.

## Contact

For repository questions, the public app owners are **@MyLaserEyes** and **@morks**. For everything else -- questions, ideas, feedback -- please use [Discussions](https://github.com/Accenture/SWAO/discussions) rather than direct messages or issues. Public threads help the whole community.
