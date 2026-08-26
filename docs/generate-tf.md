# 8. Generate TF Modules

Select option 8 from the main menu (or run `swao generate-tf`) to generate Terraform module scaffolding for the target landing zone identified during the Landing Zone Assessment.

## What it generates

SWAO reads the fit/gap report from the Landing Zone Assessment and produces:

- Terraform module stubs for each required service on the target cloud provider (e.g. STACKIT SKE, OTC OBS, IONOS Kubernetes)
- Variables file pre-populated with values derived from the assessment signals
- README for each module with the relevant LZ check references

## CLI

```bash
# Generate TF modules for the last assessed app
swao generate-tf --app my-app

# Output folder
# wsp/terraform/<run-id>/
```

## Supported providers

Terraform generation follows the Landing Zone Catalogue: STACKIT, OTC (T-Systems), IONOS Cloud, OVHcloud, Azure (West Europe), AWS (eu-central-1), and Google Cloud EU regions. Custom provider entries in the catalogue produce generic stubs.

See also: [Landing Zone Assessment](/assessment/landing-zone) | [Features & Editions](/features)
