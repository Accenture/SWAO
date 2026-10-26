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

## Matching rules (#3410)

Every pass that matches catalogue tokens or catalogue regexes against source
text (Pass 03, 05, 07, 08, 21) uses one shared matcher
(`packages/@swao/module-app-assessment/src/passes/catalogue-matcher.ts`):

| Key | Where | Meaning |
|---|---|---|
| `match_defaults.match` | file | Default match mode for token lists: `identifier`, `segment` or `substring` |
| `match_defaults.case_sensitive` | file | Default case rule (false) |
| `detection.match` / `detection.case_sensitive` | entry | Entry-level override |
| `{ token, match, case_sensitive }` | token | Token-level override (a plain string uses the defaults) |
| `detection.imports` | entry | Literal tokens, matched in code files |
| `detection.config_keys` | entry | Literal tokens, matched in configuration files (Pass 08, 21); regexes in Pass 05 |
| `detection.context` | entry | Regexes, case-insensitive, matched in code and configuration files |

Match modes:

- `identifier`: the neighbour of a word-character edge must not be
  `[A-Za-z0-9_]`. `TDEA` does not match `istDeaktiviert`; `DESede` matches
  `"DESede/CBC/PKCS5Padding"`. Default for Pass 05, 07 and 08.
- `segment`: identifier-part matching for field, package and class names.
  `_`, `-`, `.`, any other non-alphanumeric character and a lower-to-upper
  case change are boundaries: `kvnr` matches `kvnr_hash` and `patientKvnr`,
  `keycloak` matches `KeycloakService`, but `pid` does not match `rapid` and
  `eric` does not match `generic`. Default for Pass 03 and 21.
- `substring`: no boundary (the pre-#3410 behaviour), opt-in only.

A bare acronym (`3DES`, `TDEA`, `RC4`, `SHA1`, `MD5`, `EC`) is never an
`imports` token: it only counts inside a `context` regex for a call or an
assignment (`Cipher.getInstance("RC4")`, `algorithm: '3DES'`), so prose and
comments such as `// 3DES legacy note` are not findings.

Content that is never matched: files tagged generated or minified by the
source scope (`*.min.js`, `*.bundle.js`, `generated/`), files over 512 KB,
lines over 1,000 characters, base64 runs of 64 or more characters and
`data:` URIs (blanked before matching, so line numbers stay correct).

Regexes supplied by a catalogue (`context`, Pass 03 `pattern`, Pass 05
`config_keys`, Pass 21 `env_vars`) pass a ReDoS guard: nested quantifiers,
quantified alternations, backreferences and more than three unbounded
wildcards are rejected and listed under `catalogue_errors` in the pass YAML
instead of being run. Literal token lists compile to linear alternations.

## Context exceptions (#3412)

A catalogue entry may carry an `exceptions:` list. Each exception is checked
on every hit of the entry; the first one that matches sets the severity of
that hit, and the emitted signal names the exception and its rationale:

```yaml
exceptions:
  - id: totp-rfc6238                       # named in the signal
    pattern: 'algorithm\s*[:=]\s*[''"]?SHA-?1'   # regex on the hit's own line
    near: 'totp|hotp|otplib|authenticator'  # regex within `window` lines
    window: 5                               # optional, default 5, max 20
    severity: informational                 # informational | low | medium
    rationale: "RFC 6238 TOTP defaults to HMAC-SHA1"
```

- `pattern` is anchored to the line of the hit, so an `HmacSHA1` call next to a
  `MessageDigest.getInstance("SHA-1")` does not excuse the digest.
- `near` looks `window` lines either side of the hit. At least one of
  `pattern` / `near` is required; with both, both must match.
- A signal stays High while any production hit is not covered by an
  exception; when all production hits are covered it takes the strongest
  exception severity; test-code-only results keep the severity of their hits
  with low confidence (`assessment.test_code.mode: tag` down-weights them).
- Malformed or ReDoS-prone exceptions are dropped and reported under
  `catalogue_errors`; the base finding is kept.
- A workspace catalogue changes the exceptions by redefining the entry
  (workspace entry wins on `id`).

The bundled `sha1` entry ships three exceptions: `totp-rfc6238`
(Informational), `hmac-sha1` (Low, BSI TR-02102 permits SHA-1 in HMAC with
conditions) and `checksum-content-addressing` (Informational: a digest call
within three lines of a `sha1sum`, git `blob` / object header or ETag marker).

## Architecture decision

The two-tier override model, naming convention, and build-pipeline wiring for this folder are
documented in `docs/adr/0063-pass-support-catalogue-two-tier-architecture.md`.

## Verification

    swao doctor          # probe 12/14 validates pass-catalogue loading
    swao assess --dry-run  # prints which catalogue entries were matched

Documentation: https://accenture.github.io/SWAO/en/
