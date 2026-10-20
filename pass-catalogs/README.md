# Pass-support catalogues

Per-pass provider, algorithm, and pattern catalogues that feed SWAO's
deterministic pre-pass detection layer. Each file is tied to a specific
assessment pass by its filename prefix -- the pass number matches the
number shown in the SWAO TUI menu, log files, and WSP output sections.

Naming convention:

    pass-21-iam-providers.yaml    ->  IAM Assessment (Pass 21)
    pass-19-db-drivers.yaml       ->  Database Migration (Pass 19)

Files in this folder are loaded by the SWAO engine and **merged** with
the built-in catalogues in `controls/`. Workspace-level entries
(placed in `wsp/inputs/pass-catalogs/`) take precedence over built-in
entries on ID collision, allowing per-engagement overrides without
modifying shared source.

## Open-source -- extend and contribute back

These catalogues are part of the SWAO Community Edition (Apache 2.0).
You are free to add, modify, and redistribute entries under the same
licence.

If you add a provider, algorithm, or pattern entry that would benefit
other users, please open a pull request at https://github.com/Accenture/SWAO
so it can be reviewed and promoted into the built-in catalogue for everyone.

The `_template.yaml` file shows the full entry schema for each supported
catalogue type. Files starting with an underscore are ignored by discovery.

## Current catalogues

| File | Pass | What it covers |
|---|---|---|
| `pass-03-pii-patterns.yaml` | Pass 03 -- Data Classification | German social-law and health-data regulated field patterns: SGB X Sozialdaten, KVNR, RVNR, GDPR Art.9 |
| `pass-05-runtime-eol.yaml` | Pass 05 -- SBOM / CVE | Runtime and OS end-of-life entries: Java, Node.js, Python, .NET, Spring Boot, Windows Server, RHEL, Ubuntu |
| `pass-08-crypto-algorithms.yaml` | Pass 08 -- Crypto Posture | BSI TR-02102 and NIST approved and deprecated cipher, hash, KDF, and padding scheme signals |
| `pass-21-iam-providers.yaml` | Pass 21 -- IAM Assessment | Known identity providers: detection signals, sovereignty posture, eIDAS trust level |

## Architecture decision

The two-tier override model, naming convention, and build-pipeline wiring for this folder are
documented in `docs/adr/0063-pass-support-catalogue-two-tier-architecture.md`.

## Verification

    swao doctor          # probe 12/14 validates pass-catalogue loading
    swao assess --dry-run  # prints which catalogue entries were matched

Documentation: https://accenture.github.io/SWAO/en/
