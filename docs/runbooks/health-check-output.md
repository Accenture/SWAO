# Understanding health-check output

`swao health-check` runs a series of environment probes before an assessment and reports a pass/fail/warn status for each. This runbook explains what each probe checks, what the colour-coded statuses mean, and how to resolve common failures.

---

## Running health-check

The `swao doctor` command is retained as an alias for backwards compatibility.

```bash
swao health-check

# Expanded output with sub-check details
swao health-check --verbose
```

Example output:

```
SWAO v0.5.1 -- environment check

  LLM connectivity       green   Anthropic reachable; model: claude-3-5-sonnet-20241022
  Playwright             yellow  Chromium not found; dynamic pass will be skipped
  Licence                green   Consultant; expires 2027-01-15 (197 days)
  Schema version         green   workspace: 1.3  binary: 1.3
  Workspace layout       green   3 apps found in .swao.yml
  Output directory       green   ./wsp (writable)

Summary: 5 green, 1 yellow, 0 red
```

---

## Probe reference

| Probe | Green condition | Yellow condition | Red condition |
|---|---|---|---|
| LLM connectivity | Provider is reachable and responds within timeout | Response latency >5 s | No response, auth failure, or key not set |
| Playwright | Chromium found and launches correctly | Browser not found (dynamic pass disabled) | Browser found but launch fails |
| Licence | Valid licence, >30 days until expiry | Valid licence, <=30 days until expiry | Licence expired or key file missing/corrupt |
| Schema version | Workspace schema matches binary expectation | Minor schema version mismatch (additive fields) | Major schema mismatch (breaking change) |
| Workspace layout | `.swao.yml` found and parses; at least one app defined | App `source_path` directories missing | `.swao.yml` absent or fails schema validation |
| Output directory | Configured output path exists and is writable | -- | Output path does not exist or is read-only |

---

## LLM connectivity probe

**Green** -- the configured provider returns a successful response to a lightweight test prompt.

**Yellow** -- the request succeeded but took longer than five seconds. The assessment will run but may time out on individual passes if the provider is under load.

**Red** -- the request failed. Common causes:

- `ANTHROPIC_API_KEY` is not set or is incorrect.
- The `SWAO_LLM_PROVIDER` variable points to a provider that is not running (e.g. Ollama stopped).
- A network proxy or firewall is blocking the outbound request.

Fix:

```bash
# Verify the key is set
echo $ANTHROPIC_API_KEY

# Test connectivity manually
curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" | jq '.models[0].id'
```

---

## Playwright probe

**Green** -- Chromium is installed and launches without error.

**Yellow** -- Chromium is not found. The `dynamic` pass is automatically disabled; all other passes run normally. This is acceptable for server environments and CI pipelines that do not require browser-driven probing.

**Red** -- Chromium is found but fails to launch (e.g. missing shared libraries on Linux).

Fix for yellow:

```bash
# Install Chromium via Playwright
npx playwright install chromium

# Verify
npx playwright --version
```

Fix for red (Linux):

```bash
# Install required shared libraries
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libasound2
```

---

## Licence probe

**Green** -- a valid licence is present and has more than 30 days remaining.

**Yellow** -- the licence expires within 30 days. Assessment runs normally; renew before expiry to avoid interruption.

**Red** -- the licence has expired or the licence file is missing. Consultant/Enterprise features are gated. Community features remain available.

Fix:

```bash
# Check expiry date
swao license status

# Renew
swao license request
# email the token, receive new key
swao license activate <new-key>
```

---

## Schema version probe

**Green** -- the `schema_version` field in `.swao.yml` matches the version the installed binary expects.

**Yellow** -- a minor version mismatch (e.g. workspace is `1.2`, binary expects `1.3`). The assessment runs but new fields may default to zero/null.

**Red** -- a major version mismatch. The binary cannot safely parse the workspace configuration. Either upgrade the binary or run `swao migrate-config` to update the workspace schema.

```bash
# Migrate workspace config to current schema
swao migrate-config

# Then re-run doctor
swao health-check
```

---

## Workspace layout probe

**Green** -- `.swao.yml` is present, parses without error, and defines at least one app.

**Yellow** -- one or more `source_path` directories referenced in `.swao.yml` do not exist on disk. Static and SAST passes will be skipped for those apps.

**Red** -- `.swao.yml` is absent, unparseable (YAML syntax error), or fails schema validation.

```bash
# Validate YAML syntax
swao health-check --verbose 2>&1 | grep -A5 "Workspace layout"

# Or parse manually
cat .swao.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin)"
```

---

## Common failures quick-reference

| Symptom | Probe | Fix |
|---|---|---|
| `LLM connectivity: red` | LLM | Set `ANTHROPIC_API_KEY`; check network |
| `Playwright: yellow` | Playwright | Run `npx playwright install chromium` |
| `Licence: red` | Licence | Renew via `swao license activate` |
| `Schema version: red` | Schema | Run `swao migrate-config` |
| `Workspace layout: red` | Workspace | Fix `.swao.yml` syntax or create the file |
| `Output directory: red` | Output | Create the output directory or fix permissions |
