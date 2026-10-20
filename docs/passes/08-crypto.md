# Pass 08: Cryptographic Posture (CRYPTO)

| Property | Value |
|---|---|
| Pass number | 08 |
| Key | `crypto` |
| Pass name in output | `crypto_posture` |
| Signal prefix | `CRYPTO` |
| Type | Deterministic (rule engine), no LLM; separate deterministic service variant |
| Default | On |
| Assessment types | `application`; `llm` (inside each leg); `service` (conditional: runs when configuration files or binaries are supplied, using the service variant). Not run for `landing-zone-catalog`. |
| Tier | Not tier-gated (Community and above) |

## What it is for

Weak or outdated cryptography is both a security risk and a compliance blocker, and key handling often changes when an application moves to a new platform (for example from environment secrets to a key management service). Pass 08 answers: **"Does the application use sound cryptographic primitives, how are tokens signed, and is encryption at rest addressed?"**

In application mode it inspects source code and configuration. In service mode, where no source code is available, it inspects the supplied configuration files and the code-signing certificates recorded by the binary analysis.

## What you need to provide

**Application mode**

- The application source tree (JavaScript and TypeScript files are scanned), with `package.json`, and optionally `.env.example`, `prisma/schema.prisma` and `docker-compose.yml` (root or `docker/`).

**Service mode** (see [Service Portfolio Assessment](/service-assessment/))

- Configuration files or binaries in `ingestion/binary/` or `wsp/inputs/binary/`, or an installer, package, or SBOM anywhere in `ingestion/` (the pass then scans the whole `ingestion/` folder). The pass is skipped when none of these is present.
- Optional: the binary analysis result `wsp/inputs/binary/binary-analysis.json`, written by Pass 25 (BINARY) before the pass loop, for the certificate check.

No credentials or LLM are needed in either mode.

## How it works

### Application mode

1. **Scan source files** (`.ts`, `.js`, `.mjs`, `.cjs`; `node_modules`, `dist` and `fixtures` are skipped). For each primitive, the first file and line where it appears is recorded:

   | Group | Primitive | Pattern (simplified) |
   |---|---|---|
   | Strong key derivation | PBKDF2, bcrypt, Argon2id, scrypt | `pbkdf2(`, `bcrypt.hash(`, `argon2.hash(`, `scrypt(` |
   | Strong MAC | HMAC-SHA512, HMAC-SHA256 | `createHmac('sha512'` or `'sha256'` |
   | Authenticated encryption | AES-GCM | `createCipheriv('aes-128-gcm'`, `'aes-192-gcm'` or `'aes-256-gcm'` |
   | Weak (CWE-327) | MD5, SHA-1, DES | `createHash('md5')`, `createHash('sha1')`, `createCipheriv('des')` |

2. **JWT signing mode.** With `@nestjs/jwt`, `jsonwebtoken` or `jose` as a dependency, or with a `.env.example` file, the pass reads `.env.example`: `JWT_PRIVATE_KEY`, `RSA_PRIVATE_KEY`, `EC_PRIVATE_KEY` or `JWT_PUBLIC_KEY` means asymmetric signing (RS256 or ES256); `JWT_SECRET_KEY`, `JWT_SECRET` or `NEXTAUTH_SECRET` means a symmetric HMAC secret.
3. **HTTP security headers.** `helmet` or `@fastify/helmet` in the dependencies.
4. **Encryption at rest.** An encryption annotation in the Prisma schema (`encrypt`, `@encrypted`, `@cipher`, `cipher_`), a dependency whose name contains `kms` or `vault`, or `kms`, `vault` or `luks` in the Compose file.

### Service mode

1. Scans text configuration files (`.ini`, `.xml`, `.conf`, `.cfg`, `.config`, `.json`, `.env`, `.properties`, `.yaml`, `.yml`, `.toml`, `.txt`, `.reg`, up to 2 MB each) line by line for three rules:
   - `weak_algorithm`: MD5, SHA-1, RC4, 3DES or DES, ECB mode
   - `cleartext_endpoint`: `http://`, `ldap://`, `ftp://` or `telnet://` URLs other than `localhost` and `127.0.0.1`
   - `hardcoded_secret`: assignments to `password`, `passwd`, `pwd`, `secret`, `api_key`, `access_token` or `private_key` with a literal value (placeholders such as `${...}`, `%...%`, `<...>` or `***` are ignored)
2. Reads `binary-analysis.json` and counts code-signing certificates whose validity has ended before the assessment date and whose signature carries no timestamp (a timestamped signature stays valid after the certificate expires).
3. Evidence cites file and line only; matched values such as passwords are never copied into a signal.

## How it is measured

### Application mode

Signal numbers are assigned in the order below, so `CRYPTO-01` is not always the same check.

| Order | Emitted when | Severity | Meaning |
|---|---|---|---|
| 1 | Strong key derivation function found | positive | KDF in use for password or API key hashing (NIST SP 800-132 or OWASP recommendation) |
| 2 | HMAC-SHA512 or HMAC-SHA256 found | positive | Strong MAC (NIST FIPS 198-1) |
| 3 | AES-GCM passed to `createCipheriv` | positive | Authenticated symmetric encryption (NIST SP 800-38D) |
| 4 | JWT dependency, or a JWT key variable in `.env.example` | positive (asymmetric), medium (symmetric secret), low (mode undetermined) | Token signing mode; for symmetric secrets the pass recommends RS256 or ES256 with a KMS-backed key for multi-service sovereign deployment |
| 5 | Helmet present | positive | HTTP security headers enabled (OWASP A05:2021) |
| 6 | No strong or weak primitive in the source scan and none of the signals above | informational (confidence low) | No cryptographic primitives detected; manual review recommended |
| 7 | Always | positive (at-rest encryption found) or medium | Without evidence, volume encryption depends on the host and must be verified in the deployment runbook (the pass cites DORA Article 9 and BSI C5) |
| 8 onwards | One per weak primitive found | high | Broken or risky algorithm (CWE-327); replace before production |

The `assessment` block records:

- `primitives`: `api_key_hash`, `access_token`, `symmetric_encryption`, `jwt_signing`, `tls`, `at_rest_encryption`
- `overall_posture`: `weak_primitives_detected`, `good_with_infrastructure_gap` (strong KDF, MAC or AES-GCM, no weak primitive) or `unknown`
- `nist_compliant`: `true` when a strong KDF, MAC or AES-GCM is found and no weak primitive
- `blocks_migration`: `true` when any weak primitive is found

### Service mode

| Signal | Emitted when | Severity |
|---|---|---|
| `CRYPTO-NN` per rule with hits | `weak_algorithm` / `cleartext_endpoint` / `hardcoded_secret` found | high / medium / high (outcome negative); evidence lists up to 20 file:line references |
| Next `CRYPTO-NN` | At least one expired code-signing certificate without timestamp | high (outcome negative) |
| `CRYPTO-01` | Nothing found | informational, outcome indeterminate: absence in a partial sample is not proof of a sound posture |

The service `assessment` block records `mode: service`, `files_scanned`, `findings` per rule, `expired_certificates` and `blocks_migration` (weak algorithm or expired certificate).

**How results feed later passes.** CRYPTO signals are evidence for cryptography and key management controls in Pass 11 (COMP) (for example BSI C5, ISO 27001 or DORA when active in `assessment.regimes_active`) and for [Pass 09 (SYNTH)](/passes/09-synth). High-severity signals become derived security findings.

## Third-party modules and tools

None. Pattern matching uses built-in regular expressions; no external scanner or library is invoked. The certificate data in service mode comes from Pass 25 (BINARY).

## Outputs

- `wsp/runs/<ts>/passes/08-crypto.yaml` with header (`id: 8`, `name: crypto_posture`), signals and `assessment`.

## Configuration and limitations

**Configuration**

- `--passes crypto` runs the pass alone.
- Service mode: place configuration exports next to an installer or SBOM anywhere in `ingestion/`, or in `ingestion/binary/`.

**Limitations and known gaps**

- Application mode scans only JavaScript and TypeScript source and the Node.js `crypto` API naming. Java, .NET, Go, Python or Rust cryptography is not recognised.
- TLS configuration is not inspected; the `tls` primitive only reflects the presence of Helmet.
- `.env.example`, Prisma schema and Compose file are read only from fixed locations at the root (Compose also in `docker/`).
- Secrets in source code are not searched in application mode; use the opt-in malware pass ([Malware scanning](/malware-scanning)) for secret detection.
