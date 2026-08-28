# Docker Deployment

Run SWAO inside a Docker container for reproducible assessments, air-gapped environments, or team-shared infrastructure. This runbook covers the basic `docker run` invocation, a Docker Compose setup with named volumes, and offline operation using `--skip-llm`.

---

## Prerequisites

- Docker Engine 24.x or later (or Docker Desktop 4.x)
- Docker Compose v2 (if using the Compose example)
- A workspace directory on the host machine

---

## 1. Basic docker run

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/output:/output" \
  ghcr.io/accenture/swao:latest \
  assess --app sovereign-health --workspace /workspace --output /output
```

Key flags:

| Flag | Purpose |
|---|---|
| `--rm` | Remove the container after it exits |
| `-e ANTHROPIC_API_KEY` | Pass the LLM API key from the host environment |
| `-v workspace:/workspace` | Mount the SWAO workspace into the container |
| `-v output:/output` | Write assessment output to a host directory |

---

## 2. Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (unless using `--skip-llm`) | Anthropic API key for Claude |
| `SWAO_LLM_PROVIDER` | No | Override default LLM provider (`anthropic`, `ollama`, `openai`) |
| `SWAO_LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error` |
| `SWAO_WORKSPACE` | No | Default workspace path inside the container |

---

## 3. Run doctor before assess

```bash
# Check all probes before running a full assessment
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  ghcr.io/accenture/swao:latest \
  doctor
```

---

## 4. Docker Compose example

For persistent named volumes and easier multi-run usage:

```yaml
# docker-compose.yml
version: "3.9"

services:
  swao:
    image: ghcr.io/accenture/swao:latest
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SWAO_LOG_LEVEL=info
    volumes:
      - workspace:/workspace
      - output:/output
    command: assess --app sovereign-health --workspace /workspace --output /output

  swao-mcp:
    image: ghcr.io/accenture/swao:latest
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    ports:
      - "3737:3737"
    command: mcp --http --port 3737
    restart: unless-stopped

volumes:
  workspace:
  output:
```

Start the MCP server in the background and run a one-shot assessment:

```bash
docker compose up -d swao-mcp
docker compose run --rm swao
```

---

## 5. Populating the workspace volume

To seed the named `workspace` volume from a local directory:

```bash
# Copy workspace files into the named volume
docker run --rm \
  -v "$(pwd)/my-workspace:/src" \
  -v "swao_workspace:/workspace" \
  alpine sh -c "cp -r /src/. /workspace/"
```

Alternatively, bind-mount a host directory directly (replace the `workspace:` volume reference with an absolute host path):

```yaml
volumes:
  - /path/to/my-workspace:/workspace
```

---

## 6. Air-gapped usage with --skip-llm

In environments without internet access, use `--skip-llm` to run only the static and Playwright analysis passes. No API key is required and no LLM calls are made.

```bash
docker run --rm \
  -v "$(pwd)/workspace:/workspace" \
  -v "$(pwd)/output:/output" \
  ghcr.io/accenture/swao:latest \
  assess --app sovereign-health --skip-llm --workspace /workspace --output /output
```

`--skip-llm` removes the `comp` (compliance LLM) and `blocks` (block analysis) passes from the pipeline. All deterministic passes -- inventory, SBOM, cryptography, data classification, 7R synthesis, and landing zone -- still run and emit signals. Output files are written exactly as in a live run, making this mode useful for pipeline testing and schema validation without incurring API costs.

> **Note:** `--llm-stub` was removed in v0.4.7 (issue #0473). If you have scripts referencing it, replace with `--skip-llm`.

---

## 7. Pinning image versions

Avoid using the `:latest` tag in production pipelines. Pin to a specific release:

```bash
docker pull ghcr.io/accenture/swao:0.5.1
docker run --rm \
  -e ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  -v "$(pwd)/workspace:/workspace" \
  ghcr.io/accenture/swao:0.5.1 \
  assess --app sovereign-health --workspace /workspace
```

Current release tags are listed at `https://github.com/Accenture/SWAO/releases`.
