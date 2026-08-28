# Adapting Landing Zone Catalogues

SWAO ships pre-built catalogues for 12 EU sovereign and hyperscaler cloud providers. Each catalogue describes the provider's compliance posture, data residency guarantees, and certifications against SWAO's control taxonomy.

## Included catalogues

| Provider | Category |
|---|---|
| STACKIT | EU sovereign |
| OTC (T-Systems) | EU sovereign |
| IONOS Cloud | EU sovereign |
| OVHcloud | EU sovereign |
| CloudFerro | EU sovereign |
| Exoscale | EU sovereign |
| Hetzner | EU sovereign |
| gridscale | EU sovereign |
| PlusServer | EU sovereign |
| Microsoft Azure EU | Hyperscaler EU region |
| AWS eu-central-1 / ESC | Hyperscaler EU region |
| Google Cloud EU | Hyperscaler EU region |

## Catalogue format

Each catalogue is a YAML file under `wsp/inputs/catalogs/landing-zones/<provider-id>/`. The structure mirrors the community framework control taxonomy so controls can be cross-referenced during a landing zone assessment.

## Customising a catalogue

1. Copy the provider directory you want to adapt:
   ```bash
   cp -r wsp/inputs/catalogs/landing-zones/stackit wsp/inputs/catalogs/landing-zones/my-custom-lz
   ```

2. Edit `my-custom-lz/catalog-meta.yaml` to set the display name and version.

3. Update `my-custom-lz/controls.yaml` with your custom control responses.

4. Run a landing zone assessment to verify:
   ```bash
   swao assess --type landing-zone --app <app-id>
   ```

## Automatic updates

SWAO refreshes the bundled catalogues when a new release ships. Custom catalogues in `wsp/inputs/catalogs/landing-zones/` are never overwritten by SWAO -- only the built-in `community/` sub-folder is managed by SWAO itself.

To pull updated community catalogues without updating the binary, run:
```bash
swao health-check --refresh-catalogs
```
