# Troubleshooting

Reference for the most common SWAO errors. Each entry lists the error message or symptom, the likely cause, and the steps to resolve it.

---

## MODULE_NOT_FOUND pdfkit

**Symptom:** SWAO exits with `Error: Cannot find module 'pdfkit'` or similar native module error.

**Cause:** The binary's bundled native dependency (pdfkit or one of its platform-specific companions) was not correctly extracted at startup. This can happen if the binary was partially downloaded, moved to a read-only location, or if the extraction cache directory (`~/.swao/cache/`) is corrupted.

**Fix:**

```bash
# Clear the extraction cache and let SWAO re-extract on next run
rm -rf ~/.swao/cache/

# Then re-run the command that failed
swao --version
```

If the error persists, re-download the binary using a fresh copy from the releases page and verify its SHA-256 checksum before installing.

---

## EACCES permission denied

**Symptom:** `Error: EACCES: permission denied` when running `swao` on Linux or macOS.

**Cause:** The binary does not have the execute permission bit set.

**Fix:**

```bash
chmod +x /usr/local/bin/swao

# Or wherever the binary lives
which swao
chmod +x "$(which swao)"
```

---

## API key not set

**Symptom:** `Error: ANTHROPIC_API_KEY is not set` or `LLM connectivity: red` in `swao health-check`.

**Cause:** The Anthropic API key environment variable is missing from the current shell session.

**Fix:**

```bash
# Set for the current session
export ANTHROPIC_API_KEY="sk-ant-..."

# Set permanently in your shell profile
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc

# Verify
swao health-check
```

For CI environments, store the key as a repository secret and inject it via the workflow (see [CI/CD Pipeline Integration](./cicd-pipeline.md)).

---

## WSP schema mismatch

**Symptom:** `swao health-check` reports `Schema version: red`; assessment fails with a schema validation error.

**Cause:** The workspace `.swao.yml` declares an older schema version than the installed binary expects, or vice versa.

**Fix:**

```bash
# Preview the migration
swao migrate-config --dry-run

# Apply
swao migrate-config

# Verify
swao health-check
```

If you have intentionally rolled back to an older binary, ensure the binary version matches the schema version declared in `.swao.yml`.

---

## Playwright not found

**Symptom:** `Playwright: yellow` in `swao health-check`; the `dynamic` pass is skipped.

**Cause:** Playwright and/or Chromium are not installed. The yellow status means the dynamic pass is automatically disabled -- other passes run normally.

**Fix:**

```bash
npx playwright install chromium

# On Linux, also install system dependencies
npx playwright install-deps chromium
```

After installation, re-run `swao health-check` to confirm the probe turns green.

---

## MCP connection refused

**Symptom:** Claude Code (or another MCP client) reports `Connection refused` when trying to use SWAO tools.

**Cause:** The SWAO MCP server is not running.

**Fix:**

```bash
# Start the MCP server
swao mcp --http

# Verify it is listening
curl http://localhost:3737/health
```

See [MCP Server Integration](./mcp-integration.md) for persistent server setup options.

---

## Licence expired

**Symptom:** `swao health-check` reports `Licence: red`; Consultant/Enterprise features are unavailable.

**Cause:** The activation key has passed its expiry date.

**Fix:**

```bash
swao license request
# Send the token to the SWAO team to receive a renewal key
swao license activate <new-key>
swao license status
```

Community edition features remain available without a licence key.

---

## Binary reports virus

**Symptom:** Windows Defender or a third-party AV product quarantines or deletes `swao-enterprise-win.exe`.

**Cause:** Heuristic false positive. Packed Node.js binaries are sometimes flagged by reputation-based AV engines.

**Fix:** See [Windows: Allow SWAO Binary](./windows-binary-allowlisting.md) for the full allowlisting procedure. Verify the SHA-256 hash of the downloaded binary against the published `sha256sums.txt` before allowlisting to confirm it is not a genuine threat.

---

## swao health-check: LLM timeout

**Symptom:** `LLM connectivity: red` or `yellow` with a timeout error; assessment passes hang.

**Cause:** The LLM provider endpoint is unreachable or slow. Common causes include a proxy misconfiguration, a firewall rule blocking outbound HTTPS, or the Anthropic/OpenAI API experiencing degraded availability.

**Fix:**

```bash
# Test direct connectivity
curl -v https://api.anthropic.com/v1/models \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01"

# Temporarily bypass using --llm-stub
swao assess --app my-app --llm-stub
```

If your environment routes traffic via an HTTP proxy, set `HTTPS_PROXY` before running SWAO:

```bash
export HTTPS_PROXY="http://proxy.example.com:8080"
swao health-check
```

---

## publish: browser not found

**Symptom:** `swao publish` exits with an error about a browser not being found.

**Cause:** `swao publish` uses the system default browser (or Playwright's Chromium) to open the report gallery. If neither is configured, the command fails.

**Fix:**

```bash
# Option A: export the gallery to HTML instead of opening a browser
swao publish --export ./dist/gallery

# Option B: set the BROWSER environment variable
export BROWSER=/usr/bin/chromium-browser
swao publish

# Option C: install Playwright Chromium
npx playwright install chromium
```

---

## pbit template fails to load

**Symptom:** Power BI Desktop refuses to open the `.pbit` template or shows a "corrupt file" error.

**Cause:** The `.pbit` template file was modified programmatically (e.g. via a zip rewrite script). Power BI's OPC packaging format does not survive generic zip round-trips.

**Fix:** Re-export the `.pbit` natively from Power BI Desktop:

1. Open the `.pbix` source file in Power BI Desktop.
2. Select **File > Export > Power BI template**.
3. Save the new `.pbit` file.

Do not use `jszip` or similar libraries to patch `.pbit` files. See the `pbit-template-native` audit gate for the rationale.

---

## Out of memory

**Symptom:** SWAO process is killed with an out-of-memory error during a large assessment run.

**Cause:** The LLM pass processes app source files or context inputs in memory. Very large repositories or high `--max-apps` values can exhaust available RAM.

**Fix:**

```bash
# Reduce the number of apps assessed in a single run
swao assess --app my-app --max-apps 5

# Run apps sequentially instead of in parallel
swao assess --app app-one
swao assess --app app-two

# Limit Node.js heap size
NODE_OPTIONS="--max-old-space-size=4096" swao assess --app my-app
```

If the issue persists on a specific app, check for unusually large context import files (`imports/*.csv`) and reduce their size before the assessment run.

---

## Windows: blank screen on first launch or TUI does not start

**Symptom:** Double-clicking `swao-enterprise-win.exe` in Explorer (or running it directly from a terminal)
shows a blank window for several seconds, then exits -- or the TUI appears but navigation keys do not work.

**Cause:** `swao-enterprise-win.exe` is the raw pkg binary. It is designed to be called
programmatically (scripts, CI pipelines, MCP configuration). It does not configure a
Windows console environment suitable for the interactive TUI (Ink/React requires a proper
TTY with VT100 escape-code support).

**Fix:** Use `swao.bat` -- the mandated Windows entry point for interactive terminal use.
`swao.bat` is distributed alongside `swao-enterprise-win.exe` in every release. It configures the
Windows console (UTF-8 code page, ANSI/VT100 mode, TTY detection) before handing control to
the binary:

```powershell
# Correct: use the launcher
C:\Tools\swao\swao.bat

# Also correct for scripted / non-interactive use (CI, MCP configuration)
C:\Tools\swao\swao-enterprise-win.exe mcp --help
C:\Tools\swao\swao-enterprise-win.exe assess --app my-app --llm-stub

# Incorrect for interactive TUI: bypasses console setup
C:\Tools\swao\swao-enterprise-win.exe          # may show blank screen
```

If `swao.bat` is not present, download it from the same GitHub release page as the
`.exe` binary and place it in the same directory. Do not rename either file.

**Note on startup delay:** The first launch after download (or after a Windows update)
may show a 5-20 second blank terminal. This is normal -- it is the V8 snapshot
being decompressed by the pkg runtime. Subsequent launches are faster.
