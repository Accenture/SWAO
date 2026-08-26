=======================================================================

                         S  W  A  O

    Sovereign Workload Assessment and Onboarding
    Migration Guide -- v1.0.0

    Community Edition  -  Apache 2.0

    Website       :  https://steady-echo-yp4z.here.now/
    Technical Docs:  https://accenture.github.io/SWAO/en/
    Source Code   :  https://github.com/Accenture/SWAO

=======================================================================
# SWAO Migration Guide -- v1.0.0

This guide covers breaking changes and migration steps for workspaces and
integrations upgrading to SWAO v1.0.0.

---

## From pre-v0.9 workspaces

### WSP schema version

Workspaces created with SWAO earlier than v0.9 use WSP schema v0.6 or earlier.
SWAO v1.0 reads all historical schema versions for replay but writes v0.11.

**Action required:** None. Existing run directories are replay-compatible.

### `.swao.yml` field renames

The following `.swao.yml` fields were renamed between v0.8 and v0.9:

| Old field | New field | Notes |
|---|---|---|
| `provider.llm.endpoint` | `llm_gateway` connector file | Moved to per-connector YAML in `wsp/inputs/llm-gateway/` |
| `crawl.url` | vault key `playwright-url-<id>` | Credentials moved to OS credential vault |
| `crawl.user` | vault key `playwright-user-<id>` | |
| `crawl.password` | vault key `playwright-pass-<id>` | |

**Action required:** Remove the old fields from `.swao.yml`. Run `swao health-check`
to confirm vault keys are present.

### LLM connector files (new in v0.9)

LLM API configuration is now file-based. Create
`wsp/inputs/llm-gateway/<your-id>.yaml`:

```yaml
id: my-openai
name: My OpenAI connector
protocol: openai
base_url: https://api.openai.com/v1
auth:
  type: bearer_token
  env: OPENAI_API_KEY
models:
  default: gpt-4o
```

Run `swao health-check` -- probe 14 confirms the connector is valid.

---

## From v0.9--v0.10 workspaces

### Multi-leg LLM Assessment (new in v0.10)

The `--legs` flag was added for multi-leg LLM Assessment runs. Single-leg runs
continue to work unchanged. The output directory structure now uses
`wsp/runs/<timestamp>/legs/<leg-id>/` for each leg.

**Action required:** None for single-leg users. Multi-leg users: update any
downstream scripts that read from `wsp/runs/<timestamp>/` directly.

### Publication block profiles (new in v0.10)

`swao publish` now requires a `--block-profile` flag (or reads from `.swao.yml`).
Default: `standard`.

```yaml
# .swao.yml
publish:
  block_profile: standard   # standard | executive | technical | regulator
```

---

## From v0.10--v0.11 workspaces

### Vision pass output (new in v0.11)

LLM Assessment runs that include the vision pass write `vision-calls.ndjson` to
the leg directory. No migration needed; this is additive.

### Three-tier licensing (new in v0.11)

The two-edition model (Community/Premium) is replaced by a three-tier model
(Community/Consultant/Enterprise). If you hold a legacy Premium licence key, it
is compatible with the Enterprise tier binary; no re-issuance is required.

---

## Workspace validation

After any migration step, run:

```bash
swao health-check
swao assess --app <your-app-id>
```

`swao health-check` runs 16 diagnostic probes and will surface any configuration
issues introduced by the migration.

---

## Support

Questions about migrating a specific workspace configuration:
https://github.com/Accenture/SWAO/discussions

Consultant and Enterprise licensees with an active M&E contract:
swao-tool@accenture.com
