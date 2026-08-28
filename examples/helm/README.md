# SWAO Helm Chart

Deploys a one-shot Kubernetes Job that runs `swao assess` against a workspace
mounted via a PersistentVolumeClaim. Useful for scheduled assessments in a cluster
or CI/CD pipelines that run assessments as part of a release gate.

## Prerequisites

- Kubernetes 1.25+
- Helm 3.10+
- A PVC named `swao-workspace` (or override via `app.workspacePvcName`) containing
  a valid SWAO portfolio workspace (`.swao.yml`, `apps/<id>/`)
- The `ghcr.io/accenture/swao` image accessible from your cluster, or a private
  registry mirror

## Quick start

```bash
# Install with the Anthropic LLM provider
helm install swao-assess ./swao \
  --set app.id=my-app \
  --set llm.provider=anthropic \
  --set credentials.SWAO_CREDENTIAL_ANTHROPIC_API_KEY=sk-ant-...

# Dry run (no LLM calls, useful for CI smoke tests)
helm install swao-assess ./swao \
  --set app.id=my-app

# Check the Job status
kubectl get jobs,pods -l app.kubernetes.io/name=swao
kubectl logs -l app.kubernetes.io/name=swao
```

## Configuration

| Key | Default | Description |
|---|---|---|
| `image.repository` | `ghcr.io/accenture/swao` | Container image repository |
| `image.tag` | `latest` | Image tag |
| `app.id` | `""` (required) | App ID matching `apps/<id>/` in the workspace |
| `app.workspacePvcName` | `swao-workspace` | PVC containing the portfolio workspace |
| `llm.provider` | `stub` | LLM provider: `anthropic`, `ollama`, or `stub` |
| `credentials` | `{}` | Map of `SWAO_CREDENTIAL_*` env vars injected as secrets |

## Credentials

Pass credentials as Helm values (use `--set` or a sealed-secrets-managed values
file -- never commit raw API keys to version control):

```yaml
# values-prod.yaml
credentials:
  SWAO_CREDENTIAL_ANTHROPIC_API_KEY: sk-ant-...
  SWAO_CREDENTIAL_VCS_TOKEN: ghp_...
```

```bash
helm install swao-assess ./swao -f values-prod.yaml --set app.id=my-app
```

## Customising

Copy this chart into your own Helm repository or umbrella chart and modify
`templates/job.yaml` to add init containers, sidecars, node selectors, or
resource limits appropriate for your cluster.

## See also

- [`examples/batch-samples/`](../batch-samples/) -- simpler option for local or
  VM-based assessments (no Kubernetes required)
- [Installation guide](../../docs/runbooks/install.md)
- [Docker quick-start](../../README.md#docker-quick-start)
