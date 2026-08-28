# Landing Zone Assessment

Landing Zone Assessment evaluates a cloud provider's service catalogue against the
sovereignty controls derived from the active compliance frameworks. It produces a
per-service fit/gap report and an overall readiness verdict for the target landing zone.

---

## Two modes

Landing Zone Assessment runs in two distinct modes:

| Mode | How to invoke | When to use |
|---|---|---|
| **Standalone** | `--type landing-zone-catalog` | Assess the LZ independently of any application |
| **Inline** | `--lz-cat-targets` alongside `swao assess --app` | Run LZ fit in the same pipeline as an Application Assessment |

In both modes, SWAO fetches the CSP service catalogue for the requested provider and
region, then evaluates each service against the sovereignty control set derived from
the active frameworks.

---

## Supported providers

SWAO ships bundled service catalogues for the following providers:

| Provider ID | Cloud | Notes |
|---|---|---|
| `aws` | Amazon Web Services (global) | Standard commercial regions |
| `aws-esc` | AWS European Sovereign Cloud | `eusc-de-east-1` region |
| `aws-iso-e` | AWS ISO-E (restricted) | European sovereign isolated region |
| `azure` | Microsoft Azure | Global commercial |
| `gcp` | Google Cloud Platform | Global commercial |
| `stackit` | STACKIT DE | German sovereign cloud |

Run `swao lz catalogue list` to see the current catalogue inventory and last-updated dates.
Run `swao lz catalogue list --origin` to see whether each entry is bundled or workspace-overridden.

---

## Standalone assessment

### Required flags

| Flag | Description |
|---|---|
| `--type landing-zone-catalog` | Selects the LZ catalog assessment type |
| `--app <id>` | Application ID. Used to locate the workspace and scope the required-services list |
| `--lz-provider <provider>` | CSP provider ID (e.g. `stackit`, `aws-esc`) |
| `--lz-region <region>` | Region ID within the provider catalogue (e.g. `eu-de-1`) |

### Example: assess STACKIT DE sovereign cloud

```bash
swao assess --type landing-zone-catalog \
  --app my-app \
  --lz-provider stackit \
  --lz-region eu-de-1
```

### Example: assess multiple targets in one command

Use `--lz-cat-targets` to evaluate several provider/region combinations in a single run:

```bash
swao assess --type landing-zone-catalog \
  --app my-app \
  --lz-cat-targets "stackit:eu-de-1,aws-esc:eusc-de-east-1"
```

SWAO runs each target sequentially and writes a separate fit report for each pair.

### Activating sovereignty frameworks

Sovereignty gate logic is applied when one or more compliance frameworks are specified:

```bash
swao assess --type landing-zone-catalog \
  --app my-app \
  --lz-provider stackit \
  --lz-region eu-de-1 \
  --lz-frameworks "BSI_C5,GDPR"
```

Without `--lz-frameworks`, SWAO falls back to the frameworks declared in `.swao.yml`.

---

## Inline LZ fit during Application Assessment

To run the LZ catalogue fit as part of a full Application Assessment pipeline, add the
LZ target flags to the standard `swao assess` command:

```bash
# Single target inline
swao assess --app my-app \
  --lz-cat-provider stackit \
  --lz-cat-region eu-de-1

# Multiple targets inline
swao assess --app my-app \
  --lz-cat-targets "stackit:eu-de-1,aws-esc:eusc-de-east-1"
```

The LZ fit results are folded into the same HTML publication and BI export as the
Application Assessment signals.

---

## Output artefacts

A standalone LZ catalog run writes to a dedicated directory:

```
wsp/
+-- lz/<timestamp>/
|   +-- lz-catalogue-fit.yaml          fit/gap report (single target)
|   +-- lz-catalogue-fit-stackit-eu-de-1.yaml  (multi-target: one file per pair)
+-- lz/latest-landing-zone-catalog.txt pointer to the most recent LZ run timestamp
```

The fit report (`lz-catalogue-fit.yaml`) contains:

- `provider` and `region` -- the assessed target
- `frameworks` -- the sovereignty frameworks applied
- `overall_verdict` -- `ready`, `partial`, or `blocked`
- `services` -- per-service verdict with `available`, `sovereign`, `blockers`, and `gaps`
- `signals` -- individual signal entries (one per service gap or confirmation)

The HTML publication includes an LZ tab when a fit report is present. Run:

```bash
swao publish --app my-app
```

---

## Customising catalogues

The bundled catalogues can be overridden at workspace level. To copy a bundled catalogue
for editing:

```bash
swao lz catalogue copy stackit
# writes to: wsp/inputs/catalogs/lz-catalogues/stackit/index.json
```

Edit the file and re-run the assessment. SWAO picks up the workspace-level file
automatically and marks its origin as `workspace` in `swao health-check` output.

See [Adapting LZ Catalogues](/runbooks/adapting-lz-catalogues) for the full workflow.

---

## meshStack integration

SWAO includes a meshStack adapter for platform-mesh and building-block assessments.
The adapter reads a meshStack platform snapshot and evaluates the building-block
configuration against sovereignty controls.

To use it, obtain a meshStack snapshot (for example, via the meshStack scraper in
`scripts/`) and place the file at the workspace root:

```
wsp/lz-meshstack-snapshot.json
```

SWAO auto-detects the file during a portfolio assessment and runs the meshStack-specific
checks without additional `.swao.yml` configuration. Results appear in the LZ
readiness section of the HTML publication.

Portfolio-level meshStack assessment requires an Enterprise licence:

```bash
swao assess --portfolio
```

---

## Live example report

See a real Landing Zone Assessment output for the Sovereign Health demo workspace:

[Open live report](https://htmlpreview.github.io/?https://github.com/Accenture/SWAO/blob/main/examples/publications/2026-08-24T11-36-12-sovereign-health-lz.html)

This report shows the fit/gap analysis across EU sovereign and hyperscaler cloud providers, with readiness verdicts per provider.

---

## Further reading

- [Adapting LZ Catalogues](/runbooks/adapting-lz-catalogues) -- add regions, correct facts, create private-cloud entries
- [Application Assessment](./application) -- run LZ fit inline with source code analysis
- [CLI reference](/runbooks/cli-reference) -- full flag listing for `swao assess` and `swao lz`
