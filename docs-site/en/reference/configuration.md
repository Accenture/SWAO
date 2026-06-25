---
title: Configuration
---
<!-- +------------------------------------------------------------------+
     | SWAO -- Community Edition                                        |
     +------------------------------------------------------------------+ -->


# Configuration

SWAO is configured through a `.swao.yml` file in your workspace root.

## Location

By default, SWAO looks for `.swao.yml` in the current working directory. You can override
this with the `--config <path>` global flag on any command.

## Key Fields

| Field | Required | Description |
|-------|----------|-------------|
| `app` | Yes | A short identifier for the application being assessed. Used in report filenames and the TUI header. |
| `framework` | Yes | The compliance framework to assess against. Run `swao framework list` to see available values. |
| `sourcePath` | Yes | Path (relative to `.swao.yml`) to the application source files SWAO should analyse. |
| `outputPath` | No | Directory where HTML reports are written. Defaults to `./swao-output`. |
| `llm.model` | No | LLM model identifier. Defaults to the bundled Community Edition model settings. |
| `llm.maxTokens` | No | Override the maximum token budget per LLM call. |

## Example Configuration

```yaml
app: payment-service

framework: gdpr

sourcePath: ./src

outputPath: ./reports

llm:
  maxTokens: 4096
```

## Environment Variables

Environment variables take precedence over values in `.swao.yml` when both are present.

| Variable | Description |
|----------|-------------|
| `SWAO_LLM_KEY` | API key passed to the configured LLM provider. Keep this out of version control. |
| `SWAO_OUTPUT_DIR` | Override `outputPath` without editing the config file. Useful in CI pipelines. |

## Tips

- Store `.swao.yml` in version control alongside your application so assessment settings are
  reproducible.
- Never commit `SWAO_LLM_KEY` or any secrets file. Add `.env` to your `.gitignore`.
- Use `swao doctor` after any change to the config to confirm the workspace is still valid.
