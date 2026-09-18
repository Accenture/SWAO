```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Migration Guide
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://accenture.github.io/SWAO/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO Migration Guide

This guide covers breaking changes and migration steps for workspaces upgrading
between stable SWAO releases. SWAO 1.0.0 is the first public stable release;
no pre-1.0 migration path is documented here.

---

## v1.0.x to v1.1.0

v1.1.0 is a minor release. No breaking changes were introduced for Community
or Consultant workspaces.

### SWAO Chat (Enterprise, new in v1.1.0)

A new `swao chat` command and ChatScreen TUI entry are available in the Enterprise
edition. No workspace configuration is required. Chat history is written to
`wsp/chat/<sessionTs>.ndjson`.

**Action required:** None for Community and Consultant workspaces.

### Security dependency upgrades

`fast-uri`, `fastify`, and `liquidjs` were upgraded as security patches. No
application code changes are required. Run `pnpm install` if building from source.

**Action required:** None.

---

## Workspace validation

After any upgrade, run:

```bash
swao health-check
swao assess --app <your-app-id>
```

`swao health-check` runs diagnostic probes and will surface any configuration
issues introduced by the upgrade.

---

## Support

Questions about migrating a specific workspace configuration:
https://github.com/Accenture/SWAO/discussions

Consultant and Enterprise licensees with an active M&E contract:
swao-tool@accenture.com
