=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Contributing Guide

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# Contributing to SWAO

Thank you for your interest in contributing to SWAO -- Sovereign Workload
Assessment and Onboarding. This document explains how to contribute code,
compliance frameworks, and provider drivers.

## Developer Certificate of Origin

All contributions to SWAO require a Developer Certificate of Origin (DCO)
sign-off. By adding a `Signed-off-by` trailer to your commit messages you
certify that you authored the contribution and have the right to submit it
under the project licence:

```
git commit --signoff -m "feat(analyzer): add inventory pass for Rust workspaces"
```

The DCO text is available at https://developercertificate.org/.

SWAO uses DCO (not a CLA) because it is an Apache-2.0 project and DCO is
the appropriate lightweight mechanism for Apache-licensed community projects.

## Reporting Issues

- **Bugs and unexpected behaviour:** open a GitHub Issue at
  https://github.com/Accenture/SWAO/issues
- **Questions and discussion:** use GitHub Discussions at
  https://github.com/Accenture/SWAO/discussions
- **Security vulnerabilities:** see SECURITY.md for responsible disclosure

## Development Setup

Prerequisites: Node.js 20+ LTS, pnpm 10+.

```bash
git clone https://github.com/Accenture/SWAO.git
cd SWAO/swao
pnpm install

# Typecheck
pnpm exec tsc --noEmit

# Lint
pnpm lint

# Full test suite
pnpm test
```

Provider contract tests (requires a running provider):

```bash
pnpm test:contract
```

## Commit Convention

SWAO follows [Conventional Commits](https://www.conventionalcommits.org/).

```
feat(analyzer/static): add statefulness pass for Rust workloads
fix(provider/llm/ollama): handle 502 from local instance
docs(spec): clarify §10.1a signal-to-finding cascade
chore(tracker): update dependencies
```

Valid scopes include: `analyzer/static`, `analyzer/dynamic`, `analyzer/compliance`,
`analyzer/security`, `provider/llm`, `provider/vcs`, `provider/redactor`,
`report`, `cli`, `tui`, `mcp`, `spec`, `docs`, `adr`.

## Pull Request Guidelines

1. Open an issue first for non-trivial changes to discuss the approach.
2. Keep PRs focused -- one feature or fix per PR.
3. Include tests for new behaviour. The `pnpm test` suite must pass.
4. Run `pnpm exec tsc --noEmit` and `pnpm lint` before submitting.
5. Update documentation when changing user-facing behaviour.
6. Add a `Signed-off-by` trailer (see DCO above).

Maintainers aim to review community pull requests within 5 business days.
For questions before or during a contribution, use GitHub Discussions at
https://github.com/Accenture/SWAO/discussions.

For questions about Consultant or Enterprise licensing, contact:
swao-tool@accenture.com

## Contributing Compliance Frameworks

Community compliance frameworks are the fastest way to extend SWAO's
assessment coverage. A framework is a pair of files placed in
`packages/@swao/community-frameworks/frameworks/<slug>/`.

### framework-meta.yaml

```yaml
id: MY_FRAMEWORK
version: "1.0"
name: My Compliance Framework
authority: My Standards Body
description: >
  A brief description of what this framework covers and who it applies to.
applicability:
  sector: [cross-sector]
  geography: [global]
contributor:
  name: Your Name
  org: Your Organisation
  contact: https://github.com/Accenture/SWAO/discussions
licence: Apache-2.0
```

### controls.yaml

```yaml
controls:
  - id: MF-01
    title: Access Control Policy
    description: >
      The organisation shall define and enforce access control policies...
    signals:
      - IAM-01
      - SEC-AUTH-01
    guidance: >
      Evidence: check for IAM configuration files, RBAC definitions...
```

Controls use paraphrased language -- do not reproduce verbatim text from
copyrighted standards documents. Paraphrasing is acceptable fair use;
verbatim reproduction is not.

Run the framework gate to validate your files before submitting:

```bash
node tests/audit-gates/community-binary-shape.gate.mjs
```

Contributor block format: the `contributor:` block in `framework-meta.yaml`
must use your real name, organisation, and a public contact (GitHub profile
or Discussions URL). No private email addresses in committed content.

## Contributing Provider Drivers

Provider drivers implement pluggable interfaces (see `SPEC.md §15a`) so SWAO
can reach additional LLM providers, VCS systems, SAST tools, and container
scanners.

A driver lives in `packages/providers/<category>/<provider-name>/` and must:

1. Implement the interface from `@swao/core` (e.g. `LlmProvider`,
   `VcsProvider`, `RedactorProvider`).
2. Ship a contract-test suite (`*.contract.test.ts`) that passes without
   a live service using a mock/stub server.
3. Export a factory function matching the provider interface signature.
4. Include a `DRIVER.md` documenting authentication, rate limits, and
   any non-obvious behaviour.

The existing Anthropic and Ollama LLM drivers are good examples to follow.

## Licence

By contributing to SWAO you agree that your contributions will be licensed
under the Apache License, Version 2.0, consistent with the rest of the
project. See the `LICENSE` file at the repository root.
