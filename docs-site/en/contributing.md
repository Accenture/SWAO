---
title: Contributing
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->


# Contributing

Thank you for your interest in contributing to SWAO. All contributions are welcome and
appreciated. Please read the full
[CONTRIBUTING.md](https://github.com/Accenture/SWAO/blob/main/CONTRIBUTING.md) in the
repository root before submitting anything.

## Framework Contributions

The fastest way to contribute is to add a compliance framework. Frameworks are defined
entirely in YAML -- no TypeScript required. To contribute a new framework:

1. Create a directory under `docs/custom-frameworks/<your-framework-slug>/`.
2. Add a `framework-meta.yaml` file with the framework name, version, and jurisdiction.
3. Add a `controls.yaml` file enumerating the controls SWAO should check.
4. Open a pull request with a brief description of the framework and its scope.

See an existing framework such as `docs/custom-frameworks/gdpr/` for the expected structure.

## Bug Reports

If you encounter unexpected behaviour, please
[open an issue](https://github.com/Accenture/SWAO/issues/new?template=bug_report.md) on GitHub.
Include:

- SWAO version (`swao --version`)
- Operating system and Node.js version
- Steps to reproduce
- Expected versus actual behaviour
- Any relevant log output (redact any personal or sensitive data)

## Feature Requests and Discussions

For ideas, questions, or general discussion, use the
[GitHub Discussions](https://github.com/Accenture/SWAO/discussions) board. Check whether
your topic already has an open thread before starting a new one.

## Code of Conduct

All contributors are expected to follow the project
[Code of Conduct](https://github.com/Accenture/SWAO/blob/main/CODE_OF_CONDUCT.md).
