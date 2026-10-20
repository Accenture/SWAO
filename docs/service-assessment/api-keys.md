# Optional API keys

`swao service research` works without any API key. Two free keys make it faster or unlock an extra check. Both are optional, and SWAO never writes key values into the workspace, research stubs, logs, or support bundles.

## How SWAO finds a key

For each key SWAO checks, in this order:

1. The SWAO credential store (encrypted on this machine)
2. The environment variable of the same name

Storing a key in the credential store (recommended; the value is not echoed):

```bash
swao credential set NVD_API_KEY <your-key>
swao credential set VT_API_KEY <your-key>
swao credential list     # shows names only, never values
```

Or for a single shell session:

```bash
export NVD_API_KEY=<your-key>        # macOS / Linux
$env:NVD_API_KEY = "<your-key>"      # Windows PowerShell
```

## NVD API key (`NVD_API_KEY`)

The US National Vulnerability Database (NVD) is SWAO's source for CVE counts and severities per vendor and product.

| | Without key | With key |
|---|---|---|
| Request budget | 5 requests per 30 seconds | 10 requests per 30 seconds |
| Effect on a 300-app portfolio | Research takes noticeably longer | About twice as fast |

How to get one:

1. Open the NVD developers page at `https://nvd.nist.gov/developers/request-an-api-key`.
2. Enter your organisation e-mail address and accept the terms of use.
3. Confirm the activation link you receive by e-mail; the page then shows the key.
4. Store it with `swao credential set NVD_API_KEY <your-key>`.

NVD results are cached for 7 days per app; run `swao service research --refresh` to re-query earlier. With or without a key, NVD is queried only for apps with a vendor name (`vendor.name`); see [Pass 24 RESEARCH](/passes/24-research).

## VirusTotal API key (`VT_API_KEY`)

VirusTotal checks whether the SHA-256 hash of an installer you supplied is known to anti-virus engines as malicious. SWAO sends **only the hash**, never the file.

| | Without key | With key |
|---|---|---|
| VirusTotal lookup | Skipped (`skipped_reason: no_api_key`) | Detection ratio, last analysis date, and permalink per installer |
| Effect on scoring | Control APM-SEC-06 stays unscored | APM-SEC-06 "Installer not flagged as malicious" is scored |

Prerequisites: an installer that Pass 25 BINARY parses (a PE file such as `.exe` or `.dll`, or an `.msi` package) anywhere in `apps/<id>/ingestion/`, in `apps/<id>/wsp/inputs/binary/`, or in a local install path, so that Pass 25 has computed a hash. Apps without a hash are skipped with `skipped_reason: no_binary_hash`.

How to get one:

1. Create a free community account at `https://www.virustotal.com`.
2. Open your user menu and select **API key**.
3. Store it with `swao credential set VT_API_KEY <your-key>`.

The free public API allows 4 lookups per minute; SWAO paces requests accordingly. Results are cached for 7 days. Check your organisation's policy before sending file hashes to a third-party service; hashes reveal no file content but do reveal which software you run.

## Sources that need no key

endoflife.date (end of life), CISA KEV (known exploited vulnerabilities), BSI CERT-Bund (German advisories), and OSV.dev (open-source vulnerabilities) are queried without registration. See [Pass 24 RESEARCH](/passes/24-research).

Related: [Command reference](/service-assessment/commands).
