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

- The application source tree (JavaScript and TypeScript files for the built-in patterns; Java, Python, C#, Go and Kotlin code plus configuration files for the algorithm catalogue), with `package.json`, and optionally `.env.example`, `prisma/schema.prisma` and `docker-compose.yml` (root or `docker/`).

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

2. **Algorithm catalogue scan** (`pass-catalogs/pass-08-crypto-algorithms.yaml`, workspace overrides in `wsp/inputs/pass-catalogs/`). Code files (`.ts`, `.js`, `.mjs`, `.cjs`, `.java`, `.py`, `.cs`, `.go`, `.kt`) are matched against each entry's `imports` tokens, configuration files (`.yaml`, `.yml`, `.properties`, `.conf`, `.ini`, `.toml`, `.xml`, `.env`; lock files excluded) against its `config_keys`, and both against its `context` regexes. Matching uses the shared catalogue matcher: whole identifiers only (`TDEA` does not match `istDeaktiviert`), bare acronyms such as `3DES`, `RC4` or `SHA1` only inside a cipher call or an algorithm assignment (`Cipher.getInstance("DESede/...")`, `createCipheriv('rc4', ...)`, `algorithm: '3DES'`), and generated or minified files, files over 512 KB, lines over 1,000 characters, base64 runs and `data:` URIs are never matched. Every occurrence is counted (up to 50 stored per entry) and classified as production or test code. Context exceptions in the catalogue lower the severity of individual hits: SHA-1 in a TOTP/HOTP configuration (RFC 6238) is informational, HMAC-SHA1 is low, a SHA-1 digest next to a git object header, `sha1sum` or ETag marker is informational. Where a built-in pattern and a catalogue entry describe the same algorithm, the catalogue entry owns the signal. See `pass-catalogs/README.md`.

   Java (#3422): the catalogue rates JCA algorithm strings in `Cipher`, `MessageDigest`, `Mac`, `KeyGenerator`, `SecretKeyFactory` and `Signature` calls (for example `Cipher.getInstance("DESede/CBC/PKCS5Padding")`, `KeyGenerator.getInstance("DES")`, `Mac.getInstance("HmacMD5")`, `Signature.getInstance("SHA1withRSA")`, `SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")`, `MessageDigest.getInstance("SHA-256")`), BouncyCastle lightweight classes (`DESEngine`, `DESedeEngine`, `RC4Engine`, `MD5Digest`, `SHA1Digest`, `SHA256Digest`, `GCMBlockCipher`) and Spring Security password encoders: `BCryptPasswordEncoder`, `Pbkdf2PasswordEncoder`, `SCryptPasswordEncoder` and `Argon2PasswordEncoder` are approved; `NoOpPasswordEncoder`, `StandardPasswordEncoder`, `MessageDigestPasswordEncoder`, `LdapShaPasswordEncoder` and `Md4PasswordEncoder` are weak (entry `spring-legacy-password-encoder`). The approved Java entries `pbkdf2-sha2`, `scrypt` and `hmac-sha2` are paired with the built-in JavaScript patterns, so a repository with both reports the KDF or MAC once.
3. **Java Cryptography Architecture inventory (#3422).** In the same single read, every JCA engine call with a literal algorithm string (`Cipher`, `MessageDigest`, `Mac`, `KeyGenerator`, `KeyPairGenerator`, `SecretKeyFactory`, `KeyFactory`, `Signature`, `KeyAgreement`, `KeyStore`, `SecureRandom`, `AlgorithmParameters`, `CertificateFactory`, `TrustManagerFactory`, `KeyManagerFactory`, `SSLContext`) and every BouncyCastle provider registration in Java, Kotlin, Groovy or Scala files is listed with file and line, whether the catalogue rates the algorithm or not (for example `AES/CBC/PKCS5Padding`, `SHA1PRNG`, `PKCS12`). Up to 50 calls are stored, production first; the total counts every call, the per-algorithm counts cover the stored calls, and `truncated` marks a longer list.
4. **JWT signing mode.** With `@nestjs/jwt`, `jsonwebtoken` or `jose` as a dependency, or with a `.env.example` file, the pass reads `.env.example`: `JWT_PRIVATE_KEY`, `RSA_PRIVATE_KEY`, `EC_PRIVATE_KEY` or `JWT_PUBLIC_KEY` means asymmetric signing (RS256 or ES256); `JWT_SECRET_KEY`, `JWT_SECRET` or `NEXTAUTH_SECRET` means a symmetric HMAC secret.
5. **HTTP security headers.** `helmet` or `@fastify/helmet` in the dependencies.
6. **Encryption at rest.** An encryption annotation in the Prisma schema (`encrypt`, `@encrypted`, `@cipher`, `cipher_`), a dependency whose name contains `kms` or `vault`, or `kms`, `vault` or `luks` in the Compose file.

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
| 6 | No built-in or catalogue hit and none of the signals above | informational (confidence low) | "No cryptographic primitives detected by pattern scan (languages scanned: ...; files: N)"; manual review recommended |
| 7 | Always | positive (at-rest encryption found) or medium | Without evidence, volume encryption depends on the host and must be verified in the deployment runbook (the pass cites DORA Article 9 and BSI C5) |
| 8 onwards | One per weak primitive found | high when a production occurrence is not covered by a context exception; the strongest exception severity when every production occurrence is covered (confidence medium); unchanged but confidence low when seen in test code only; with `assessment.test_code.mode: tag` the test-code marker then lowers it one step | Broken or risky algorithm (CWE-327): "N occurrences (P production, T test)", the exceptions applied with their rationale, up to 10 locations with production code first |
| Next numbers | One per approved catalogue algorithm found whose built-in twin did not already produce a positive signal above | positive (informational when seen in test code only) | Approved primitive with its BSI TR-02102 and NIST status and the occurrence count |
| Last | At least one JCA call with a literal algorithm (step 3) | informational, confidence high | "Java Cryptography Architecture usage": engine and algorithm with counts, registered providers, "N occurrences (P production, T test)", up to 10 locations with production first; suppresses the row 6 fallback but never changes `overall_posture`, `nist_compliant` or `blocks_migration` |

The `assessment` block records:

- `primitives`: `api_key_hash`, `access_token`, `symmetric_encryption`, `jwt_signing`, `tls`, `at_rest_encryption`
- `overall_posture`: `weak_primitives_detected`, `weak_primitives_context_excepted` (every production occurrence covered by a context exception), `weak_primitives_in_test_code_only`, `good_with_infrastructure_gap` (strong KDF, MAC, AES-GCM or approved catalogue algorithm in production code, no weak primitive) or `unknown`
- `nist_compliant`: `true` when a strong primitive is found in production code and no weak primitive
- `blocks_migration`: `true` when a weak primitive has a production occurrence that no context exception covers, or (default `include` test-code mode only) a High occurrence in test code
- `hits`: per catalogue entry `total`, `production`, `test`, `unclassified`, `truncated` and the stored `locations` (file, line, path class, rule, exception)
- `jca_inventory` (when a JCA call was found): `total`, `production`, `test`, `unclassified`, `truncated`, `algorithms` (engine, algorithm, count), `providers` and the stored `locations`
- `pattern_scan`: `languages`, `configuration_files` and `files` read by the pattern scans
- `catalogue_errors` (when present): catalogue entries, context regexes or exceptions that failed validation or the ReDoS guard and were skipped

### Service mode

| Signal | Emitted when | Severity |
|---|---|---|
| `CRYPTO-NN` per rule with hits | `weak_algorithm` / `cleartext_endpoint` / `hardcoded_secret` found | high / medium / high (outcome negative); evidence lists up to 20 file:line references |
| Next `CRYPTO-NN` | At least one expired code-signing certificate without timestamp | high (outcome negative) |
| `CRYPTO-01` | Nothing found | informational, outcome indeterminate: absence in a partial sample is not proof of a sound posture |

The service `assessment` block records `mode: service`, `files_scanned`, `findings` per rule, `expired_certificates` and `blocks_migration` (weak algorithm or expired certificate).

**How results feed later passes.** CRYPTO signals are evidence for cryptography and key management controls in Pass 11 (COMP) (for example BSI C5, ISO 27001 or DORA when active in `assessment.regimes_active`) and for [Pass 09 (SYNTH)](/passes/09-synth). High-severity signals become derived security findings.

## Third-party modules and tools

None. Pattern matching uses built-in regular expressions and the shared catalogue matcher (`catalogue-matcher.ts`); no external scanner or library is invoked. The certificate data in service mode comes from Pass 25 (BINARY).

## Outputs

- `wsp/runs/<ts>/passes/08-crypto.yaml` with header (`id: 8`, `name: crypto_posture`), signals and `assessment`.

## Configuration and limitations

**Configuration**

- `--passes crypto` runs the pass alone.
- Service mode: place configuration exports next to an installer or SBOM anywhere in `ingestion/`, or in `ingestion/binary/`.

**Limitations and known gaps**

- The built-in patterns cover only JavaScript and TypeScript and the Node.js `crypto` API naming. Java, .NET, Go, Python and Kotlin cryptography is recognised through the algorithm catalogue entries, and Java/Kotlin JCA calls are inventoried; Rust is not scanned.
- The JCA inventory needs a literal algorithm string: `Cipher.getInstance(ALGORITHM)` with a constant or a value from configuration is not listed. Key sizes (`KeyGenerator.init(1024)`, RSA modulus length) are not evaluated.
- The JCA inventory stores at most 50 calls, production first. The total counts every call, but the per-algorithm counts cover the stored calls only: in a large code base an algorithm that appears only beyond the first 50 calls is missing from `algorithms` (`truncated` marks this case).
- Test code is recognised by path (`test/`, `tests/`, `__tests__/`, `systemtest/`, `src/test/java`, `*.test.ts`, `*Test.java` and similar); a weak primitive used only there blocks migration only in the default `include` test-code mode, not under `tag` or `exclude`.
- TLS configuration is not inspected; the `tls` primitive only reflects the presence of Helmet.
- `.env.example`, Prisma schema and Compose file are read only from fixed locations at the root (Compose also in `docker/`).
- Secrets in source code are not searched in application mode; use the opt-in malware pass ([Malware scanning](/malware-scanning)) for secret detection.
