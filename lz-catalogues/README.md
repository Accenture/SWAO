```
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     Landing Zone Catalogues
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://accenture.github.io/SWAO/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
```

# SWAO Landing Zone Catalogues

Curated cloud provider service catalogues for SWAO Landing Zone Assessments.

Each catalogue is a JSON file describing a cloud provider's available services,
sovereignty characteristics, and regional deployment options. SWAO uses these
during a Landing Zone Assessment to validate readiness checks against your
target provider.

## Download

Browse and download catalogues from GitHub:
**https://github.com/Accenture/SWAO/tree/main/lz-catalogues**

## Available catalogues

| File | Provider |
|---|---|
| `aws.json` | Amazon Web Services (eu-central-1 / Frankfurt) |
| `aws-esc.json` | AWS European Sovereign Cloud |
| `aws-iso-e.json` | AWS ISO-E (sector-specific sovereign) |
| `azure.json` | Microsoft Azure (EU regions) |
| `azure-local.json` | Azure Local (on-premises sovereign) |
| `delos.json` | Delos Cloud (SAP / Arvato Systems, DE) |
| `gcp.json` | Google Cloud Platform (EU regions) |
| `oci.json` | Oracle Cloud Infrastructure (EU / OCI sovereign) |
| `otc.json` | Open Telekom Cloud (T-Systems, DE / EU) |
| `stackit.json` | STACKIT (Schwarz Group, DE / EU) |

There is no index file. SWAO builds the catalogue list by scanning this
folder for `<provider>.json` files and reading each file's own `meta` block
(name, last_updated, source.mode, confidence, regions_count). Files starting
with `_` (`_lz-catalogue-template.json`, `_coming-soon.json`),
`*-service-meta.json` and the `prices/` folder are support files, not
catalogues. Providers announced but not yet catalogued are listed in
`_coming-soon.json`, the only place that list lives.

## Usage

Place catalogue files in your workspace or reference them via the SWAO configuration.
SWAO resolves the active provider catalogue during assessment initialisation.

## Contributing

To contribute a new provider catalogue, open a
[GitHub Issue](https://github.com/Accenture/SWAO/issues) or submit a pull request
following the schema in `_template.yaml` (if present) or modelled on an existing
catalogue entry.

## Licence

Apache-2.0. See [LICENSE](../LICENSE).
