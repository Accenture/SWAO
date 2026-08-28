# Scripts

Helper scripts for operators who build or deploy SWAO from this repository.

| Script | Requires | What it does |
|---|---|---|
| `build-image.sh` | Docker | Builds the Community Docker image from the repo root using `Dockerfile.community`. Accepts an optional tag argument; defaults to `accenture/swao:dev`. |
| `helm-lint.sh` | Helm 3 | Validates the Helm chart in `examples/helm/swao/` with `helm lint`. Run this before deploying to a cluster or submitting a chart change. |

## build-image.sh

```bash
# Default tag (accenture/swao:dev)
bash scripts/build-image.sh

# Custom tag
bash scripts/build-image.sh ghcr.io/your-org/swao:v1.0.0
```

After building, run an assessment against a local workspace:

```bash
docker run --rm \
  -v "$(pwd)/my-portfolio":/workspace \
  -e SWAO_CREDENTIAL_ANTHROPIC_API_KEY="sk-ant-..." \
  accenture/swao:dev assess --app my-app
```

The pre-built Community image is published to `ghcr.io/accenture/swao:latest` for
`linux/amd64` and `linux/arm64` -- pull it directly if you do not need to customise
the image.

## helm-lint.sh

```bash
bash scripts/helm-lint.sh
```

Requires `helm` 3 on PATH. Install from https://helm.sh/docs/intro/install/ if not present.
See [`examples/helm/README.md`](../examples/helm/README.md) for full deployment instructions.
