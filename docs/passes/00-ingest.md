# Pass 00: Ingestion (INGEST)

| Property | Value |
|---|---|
| Pass number | 00 |
| Key | `ingest` (pre-pass; not selectable with `--passes`) |
| Signal prefix | none (Pass 00 emits no signals) |
| Type | Deterministic file normalisation, no LLM |
| Default | Always runs before the pass loop when `<app>/ingestion/` exists and contains files |
| Assessment types | `application`, `service` (always runs), `llm` (runs inside each leg's assessment). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Engagement material rarely arrives in a tidy structure. Clients hand over architecture slide decks, Word workshop minutes, PDF policies, Excel CMDB exports and Terraform state files, often all in one folder. Pass 00 answers the question: **"How do I get all of this material in front of the assessment without sorting it by hand?"**

You drop files into one folder, `<app>/ingestion/`. Pass 00 sorts each file into the structured `wsp/inputs/` tree that the later passes read, extracts readable text from Office and PDF files so that the LLM passes can use them, and remembers what it has already processed so that re-runs are fast.

## What you need to provide

- Files in `<app>/ingestion/` (subfolders are allowed and are kept in the target path). Files named `.gitkeep`, `README.md` and `ingestion-manifest.json` are ignored.
- Nothing else is required. When `ingestion/` is missing or empty, the pass does nothing.
- Optional: Pulumi Cloud stacks listed under `iac.pulumi.stacks` in the app `.swao.yml`, with a Pulumi access token stored in the SWAO credential store under the key `pulumi-api-token`. Pass 00 then downloads each stack export before it processes local files.

Do not place archives in `ingestion/`. Extract them first and place the files individually.

## How it works

1. **Optional Pulumi download.** For each configured stack (`org`, `project`, `stack`), SWAO calls the Pulumi Cloud export endpoint (`https://api.pulumi.com/api/stacks/{org}/{project}/{stack}/export`) and writes the result to `wsp/inputs/pulumi/<project>-<stack>.json`. Pass 01 reads these files later.
2. **List files.** All files under `ingestion/` are listed recursively.
3. **Reference binaries, reject archives.** Executables, installers and packages under `ingestion/binary/` (`.exe`, `.msi`, `.msp`, `.msix`, `.appx`, `.dll`, `.sys`, `.so`, `.dylib`, `.jar`, `.war`, `.ear`, `.pkg`, `.dmg`, `.deb`, `.rpm`, `.cab`, plus `.bin`, `.iso`, `.img` and the archive types below) are not copied, in every assessment type. In a Service Portfolio Assessment the installer and package types are also referenced anywhere else under `ingestion/`, because service apps have no hint folders; in an application assessment such a file outside `ingestion/binary/` is copied into `wsp/inputs/` as before. Referenced files are recorded as `referenced` in the manifest (path and size, no hash). In a Service Portfolio Assessment, [Pass 25 BINARY](/passes/25-binary) analyses them in place: it reads `ingestion/binary/` and the installer and package files anywhere else under `ingestion/`. A copy left in `wsp/inputs/` by an earlier run is removed. Anywhere else, files ending in `.zip`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.7z` or `.rar` are not copied either: they are recorded as `rejected` with a warning to extract them.
4. **Warn on files without text.** Images (`.jpg`, `.jpeg`, `.png`, `.gif`, `.svg`, `.bmp`, `.webp`, `.ico`) are always routed to `intake/` and flagged `image-no-text-extraction`; add a `.description.txt` sidecar if the picture matters. `.xps` files produce a warning to convert them to PDF.
5. **Route each file to a category folder.** The decision is made from the **file name** and extension:
   - Name rules are checked first. For example: names containing `sbom`, `bom` or `bill-of-materials` (as `.xlsx`, `.csv`, `.xml`, `.json`, `.cdx`) go to `compliance/`; names containing `cmdb` or `incident` (as `.csv` or `.xlsx`) go to `operations/`; `network-flow*` or `nftables*` CSVs go to `operations/`; Terraform and HCL files, and YAML files whose names contain words such as `infra`, `k8s`, `helm`, `deploy`, `pipeline` or `ansible`, go to `terraform/`; PDFs with `policy` or `procedure` in the name go to `architecture/guardrails/`; PDFs starting with `dpa` or `soc`, or containing `agreement` or `legal`, go to `compliance/`; `.docx` files go to `workshops/`; `.pptx` files and Markdown files go to `architecture/` (Markdown starting with `workshop`, `meeting` or `notes` goes to `workshops/`); source code files go to `intake/`.
   - When no rule matches, the extension decides: `.csv`, `.xlsx`, `.xls` to `operations/`; `.pdf`, `.docx`, `.doc`, `.pptx` to `docs/`; `.yaml`, `.yml`, `.json` to `structured/`; `.md`, `.txt` to `architecture/`; `.tf`, `.tfstate`, `.tfplan`, `.hcl` to `terraform/`; anything else to `intake/`.
   - The target path is `wsp/inputs/<category>/<original relative path>`. On later runs the previous target is reused so files do not move between runs.
6. **Skip unchanged files.** Each file's SHA-256 hash is compared with the previous manifest. If the hash matches, the target exists and all extracted companion files exist, the file is skipped. Each document counts as new (not in the previous manifest), changed (different hash, or the copy or a companion is missing) or unchanged.
7. **Copy and extract text.** New or changed files are copied. Binary office formats are then converted into a text companion next to the copy:
   - PDF to `<file>.extracted.txt` (pdf-parse)
   - DOCX to `<file>.extracted.md` (mammoth; falls back to reading the raw document XML if mammoth fails)
   - XLSX to one `<file>.<sheet name>.csv` per worksheet (exceljs)
   - PPTX to `<file>.extracted.txt` with the text of every slide (adm-zip)
   - `.xls` and legacy `.doc` files are copied but not extracted; a warning asks you to convert them to `.xlsx` or `.docx`.
   - Files larger than 10 MB are copied but not extracted.
8. **Clean up.** When a file disappears from `ingestion/`, its copy and companions are removed from `wsp/inputs/`.
9. **Warn on unmanaged files.** Files placed directly in `wsp/inputs/` subfolders that Pass 00 does not manage trigger a warning recommending you move them into `ingestion/`. Reserved folders are not checked: `source`, `catalogs`, `terraform`, `yara-rules`, `checklists`, `evidence`, `interviews`, `cmdb`, `llm-gateway`, `research`, `binary`.
10. **Write the manifest** to `ingestion/ingestion-manifest.json`.

## How it is measured

Pass 00 does not produce signals or scores. Its effect is indirect:

- Every text file it places under `wsp/inputs/` becomes context for [Pass 04 (CTX)](/passes/04-ctx). The category folder it chooses also sets that file's priority in the CTX prompt budget (for example `architecture/`, `compliance/` and `intake/` rank highest).
- Terraform state in `wsp/inputs/terraform/` and Pulumi exports in `wsp/inputs/pulumi/` feed the service detection of [Pass 01 (INV)](/passes/01-inv).
- SBOM exports routed to `wsp/inputs/compliance/` can feed [Pass 05 (SBOM)](/passes/05-sbom).

The console line `Ingestion normalised  N file(s) (category: count, ...)` summarises each run, and `[info] INGEST: N new, M changed, K unchanged document(s) in ingestion/` shows what a re-run picked up.

## Third-party modules and tools

| Name | Purpose in this pass | Licence (package metadata) | Bundled or external | When missing |
|---|---|---|---|---|
| pdf-parse | PDF text extraction | MIT | Bundled | Not applicable (bundled); a failing file is copied without extraction and a warning is printed |
| mammoth | DOCX to Markdown | BSD-2-Clause | Bundled | Falls back to raw XML text extraction |
| exceljs | XLSX worksheets to CSV | MIT | Bundled | Not applicable (bundled) |
| adm-zip | PPTX slide text, DOCX fallback | MIT | Bundled | Not applicable (bundled) |
| Pulumi Cloud API | Stack export download (optional) | External service; licence not recorded in repo | External, network access and token required | Pulumi step is skipped with a `pulumi-token-missing` or `pulumi-fetch-failed` warning; file ingestion continues |

## Outputs

| Path | Content |
|---|---|
| `ingestion/ingestion-manifest.json` | Schema version, timestamp, every routed file (source, target, category, SHA-256, size, extracted companions), per-category counts, rejected files, installers and packages referenced in place (`referenced`) |
| `wsp/inputs/<category>/...` | Routed copies of your files |
| `wsp/inputs/<category>/....extracted.txt`, `.extracted.md`, `.<sheet>.csv` | Extracted text companions |
| `wsp/inputs/pulumi/<project>-<stack>.json` | Pulumi stack exports (only with `iac.pulumi.stacks`) |

Pass 00 writes no file under `wsp/runs/<ts>/passes/`.

## Configuration and limitations

**Configuration**

- `iac.pulumi.stacks` in the app `.swao.yml`: list of `{ org, project, stack }`; token from the credential store key `pulumi-api-token`.
- `swao ingest [--workspace <path>] [--app <id>]` runs Pass 00 on its own. Use it before `swao assess` when you have a large document collection, so extraction does not slow down the assessment.
- `swao assess` always runs Pass 00 before the pass loop (in a Service Portfolio Assessment, after Pass 25 BINARY); `--passes` does not affect it.

**Limitations and known gaps**

- Routing uses file names and extensions, not file content. Name your files descriptively (for example `cmdb-export.xlsx`, `architecture-overview.pptx`) to land them in the right folder.
- Images and `.xps` files carry no text into the LLM passes.
- `.xls` and `.doc` files and files above 10 MB are copied without text extraction. Convert legacy Office files to `.xlsx` or `.docx` first.
- Archives are rejected, not unpacked. Under `ingestion/binary/` they are referenced like installers instead.
- In a [Service Portfolio Assessment](/service-assessment/), `swao service init` creates only the empty `apps/<id>/ingestion/` folder; drop files into it in any subfolder or none. Text files keep their subfolder as part of the path below the category folder (for example `ingestion/binary/x.json` becomes `wsp/inputs/structured/binary/x.json`). Hint folders such as `binary/` and `data-flow/` from earlier versions still work: the service pass profile looks for them in `wsp/inputs/` and `ingestion/` first, and otherwise uses the installers, SBOMs and documents found anywhere under `ingestion/`. Installers stay where they are and take no extra disk space in `wsp/inputs/`.
