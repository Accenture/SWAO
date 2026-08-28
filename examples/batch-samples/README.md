# SWAO batch samples

Ready-to-edit scripts for the common operator workflow: **assess N
apps in one engagement, then emit the portfolio BI bundle in a
single run**. Copy the script to your workspace (or run it in
place), edit the three variables at the top, and execute.

Both samples halt on the first error so a half-finished bundle is
never written silently.

---

## Files

| File | Platform | Use when |
|---|---|---|
| `assess-portfolio.cmd` | Windows (cmd.exe / PowerShell) | Native Windows engagement |
| `assess-portfolio.sh`  | POSIX (bash / zsh / Git Bash on Windows) | macOS, Linux, or Windows + Git Bash |

## Configure (edit the top of the script)

Three variables at the top of each file:

| Variable | What it points at | Example |
|---|---|---|
| `SWAO_BIN`   | Absolute path to the SWAO binary | `C:\Projects\accenture\swao\dist-bin\swao-enterprise-win.exe` |
| `WORKSPACE`  | Absolute path to the engagement workspace (contains `.swao.yml`) | `C:\swao-e2e` |
| `APP_LIST`   | Space-separated app ids -- one per `apps/<id>/` directory | `sovereign-health e2e-ct app-three` |

The POSIX script also accepts environment-variable overrides, so
you can run a one-off without editing:

```bash
SWAO_BIN=/path/to/swao APP_LIST=(app-a app-b) bash assess-portfolio.sh
```

## Run

### Windows

```cmd
cd C:\Projects\accenture\swao\ops\batch-samples
assess-portfolio.cmd
```

### POSIX (or Git Bash on Windows)

```bash
cd /c/Projects/accenture/swao/ops/batch-samples
bash assess-portfolio.sh
```

## What the script does

1. **Pre-flight check (doctor).** Runs `swao doctor` and aborts on
   any FAIL row. This catches the common "licence missing",
   "anthropic-api-key not in keychain", or "Chromium not installed"
   situations before you spend LLM tokens on the assess loop.
2. **Per-app assess loop.** Iterates `APP_LIST` in order and runs
   `swao assess --app <id>` for each. Aborts on the first failure;
   the operator sees which app failed and the path to inspect.
3. **Portfolio export.** Runs `swao export --portfolio` to emit the
   roll-up BI bundle that aggregates every assess result in the
   workspace. Premium licence required.
4. **Echo summary.** Prints the binary version and a pointer to
   where the .pbit lives so the operator knows what to refresh in
   PowerBI Desktop next.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All steps completed; bundle is ready to refresh |
| 1 | doctor failed, an assess failed, or export failed -- inspect the printed message |

## Adapting for your engagement

- **More than five apps?** Just lengthen `APP_LIST`. The loop has
  no upper bound.
- **Single-app run?** Set `APP_LIST` to one id and replace
  `export --portfolio` with `export` (single-app). Or drop the
  portfolio line entirely if you only want the per-app bundles.
- **Different binary location?** Edit `SWAO_BIN`. The script does
  not require the binary to be on PATH.
- **CI use?** The script is exit-code-clean and prints to stdout
  only; pipe to a log file and let your CI scheduler trigger it
  on a cron.

## See also

- `swao/docs/runbooks/cli-reference.md` -- full CLI reference with
  one section per top-level command.
- `swao --help`, `swao assess --help`, etc. -- in-binary help is
  the source of truth for flag details.
