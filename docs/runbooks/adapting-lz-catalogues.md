# Adapting Landing Zone Catalogues

SWAO ships pre-built service catalogues for 10 cloud providers. Each catalogue lists the provider's regions, their sovereignty facts (data residency, certifications), and the services available per region. The Landing Zone Catalog Assessment and the inline catalogue fit of an application assessment compare an app against these catalogues.

## Included catalogues

| Provider ID | Catalogue |
|---|---|
| `aws` | AWS |
| `aws-esc` | AWS European Sovereign Cloud |
| `aws-iso-e` | AWS ISOE Europe (classified) |
| `azure` | Microsoft Azure |
| `azure-local` | Azure Local |
| `delos` | Delos Cloud |
| `gcp` | Google Cloud |
| `oci` | Oracle Cloud Infrastructure |
| `otc` | Open Telekom Cloud / T Cloud Public |
| `stackit` | STACKIT |

`swao lz catalogue list` prints the same list with region and service counts; `swao lz catalogue show <provider>` prints the regions, sovereignty facts, and services of one provider.

## Catalogue format

Each catalogue is a JSON file. The bundled set lives in the `lz-catalogues/` folder of the SWAO distribution, one `<provider>.json` file per provider. There is no index file: SWAO lists every catalogue from its own `meta` block (name, `last_updated`, `source.mode`, confidence, `regions_count`), so a new catalogue file is picked up without registering it anywhere. Files starting with `_` (`_lz-catalogue-template.json`, `_coming-soon.json`), `*-service-meta.json` and the `prices/` folder are support files, not catalogues; `_coming-soon.json` is the only place the providers announced as coming soon are listed. An `index.json` left in an older workspace folder is ignored and can be deleted. A workspace catalogue lives at `wsp/inputs/catalogs/lz-catalogues/<provider>/index.json`. `swao init` seeds the bundled catalogue files into `wsp/inputs/catalogs/lz-catalogues/` of a new workspace so that you can edit them directly.

## Customising a catalogue

1. Copy the bundled catalogue of the provider you want to adapt into the workspace:
   ```bash
   swao lz catalogue copy stackit
   ```
   This writes `wsp/inputs/catalogs/lz-catalogues/stackit/index.json`. Use `--force` to overwrite an existing copy.

   For a provider that SWAO does not ship (private cloud, managed hosting, internal platform), create an empty scaffold instead:
   ```bash
   swao lz catalogue new my-private-cloud
   ```

2. Edit the JSON file: adjust `meta` (name, `last_updated`, source note) and the `regions[]` entries with their services.

3. Check which copy SWAO uses:
   ```bash
   swao lz catalogue show stackit
   ```
   The output names the origin (`workspace` or `bundled`) and the file that was read.

4. Run a landing zone catalogue assessment to verify:
   ```bash
   swao assess --type landing-zone-catalog --app <app-id> --lz-provider stackit --lz-region <region-id>
   ```

## Updating catalogues

SWAO refreshes the bundled catalogues when a new release ships. Workspace copies are never overwritten by a new release.

To refresh the service lists from the providers' public sources without updating the binary, run (Consultant tier and above; no credentials required):

```bash
swao lz catalogue update --provider all
```

`--provider` accepts `aws`, `aws-esc`, `aws-iso-e`, `stackit`, `gcp`, `azure`, or `all`. The refreshed catalogues are written to `wsp/inputs/catalogs/lz-catalogues/` of the workspace (or to `--catalogues-dir`). `--dry-run` prints the statistics without writing files; the `--endpoints-path`, `--products-path`, and `--azure-prices-path` options read local source files for air-gapped use.

The same run refreshes the VM prices of the service cost model (see [Service assessment configuration](/service-assessment/configuration#cost-prices)): with `--provider azure`, `aws` or `all` it reads the on-demand Linux and Windows prices of the sizes the cost model uses from the Azure Retail Prices API (`germanywestcentral`) and the AWS Price List bulk API (`eu-central-1`, a large file that is streamed). Both are public; SWAO sends GET requests only. The result is written to `prices/vm-prices.json` in the same folder, with the API, URL, region, currency and retrieval date of each source, and the cost model prefers it over the bundled table. Prices of a provider that was not refreshed, or whose price API failed, are kept from the previous table; a failed price API is a warning and does not stop the catalogue update. `--skip-prices` skips the price refresh; `--azure-price-api <url>` and `--aws-price-list <url>` point to a mirror or proxy of the two APIs.
