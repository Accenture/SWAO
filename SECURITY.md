# Security Policy

## Supported versions

Only the latest release receives security fixes. Older versions are not patched.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

---

## Reporting a vulnerability

**Do not report security vulnerabilities via public GitHub issues.**

Send a report to:
swao-tool@accenture.com

Use the subject line: `[SECURITY] SWAO vulnerability report`

If the report contains sensitive proof-of-concept material, encrypt it to the
GPG key published at `swao-security.asc` in this repository.

Key fingerprint: `7F50 A63D 2884 751B 902E D453 F876 CFFE D7D9 5A7A`

Import with:

    gpg --import swao-security.asc

### What to include

- Description of the vulnerability and the affected component
- Steps to reproduce or a proof-of-concept (minimal reproduction preferred)
- Potential impact: what can an attacker achieve?
- Your suggested severity (Critical / High / Medium / Low)
- Your preferred attribution (name and/or GitHub handle, or anonymous)

---

## Response SLA

| Severity | Acknowledgement | Initial assessment | Target fix |
|---|---|---|---|
| Critical (RCE, auth bypass, key exposure) | 1 business day | 2 business days | 7 days |
| High (significant data exposure, privilege escalation) | 2 business days | 5 business days | 14 days |
| Medium (limited-impact disclosure, denial of service) | 5 business days | 10 business days | 30 days |
| Low (informational, hardening) | 5 business days | 14 business days | Next release |

We will keep you informed throughout the process and credit you in the release notes
unless you prefer to remain anonymous.

---

## Coordinated disclosure

We follow responsible disclosure practices:

1. Reporter submits a private report.
2. Maintainers confirm receipt and assess severity within the SLA above.
3. A fix is developed in a private fork or branch.
4. The fix is released; a GitHub Security Advisory is published simultaneously.
5. Reporter is credited (if desired) in the advisory and release notes.
6. A 90-day embargo applies from the date of our initial acknowledgement.
   If we cannot deliver a fix within 90 days we will communicate this and agree
   a revised timeline with the reporter.

---

## In scope

Vulnerabilities that affect SWAO Community Edition users or SWAO operators:

- Remote code execution via crafted workspace input files (`.swao.yml`, WSP schema,
  framework YAML, IaC HCL)
- Authentication or authorisation bypass in the licence guard (`LicenseGuard`)
- Secret exposure via SWAO's logging or output (e.g. LLM API keys leaked to stdout)
- Dependency vulnerabilities with a demonstrated exploit path in SWAO's attack surface
- Privilege escalation via the MCP server's tool interface
- Credential exfiltration via the Playwright crawl path

---

## Out of scope

- Theoretical vulnerabilities without a working proof-of-concept
- Issues affecting only unsupported versions
- Social engineering attacks targeting contributors or maintainers
- Vulnerabilities in third-party dependencies with no exploitable impact on SWAO
- Issues that require physical access to the operator's machine
- Denial-of-service via crafted LLM responses (the LLM is an external untrusted input
  by design; timeout and budget limits are the primary mitigations)

---

## Security posture

SWAO is designed for sovereign and regulated environments. Key security properties:

- **Air-gapped licence verification.** No outbound network call is made during licence
  verification. The Ed25519 signature is checked locally against a public key baked
  into the binary.
- **Secret redaction.** All LLM API calls pass through a pre-call redactor that strips
  secret-shaped values before they leave the machine. Redacted content is never logged.
- **No telemetry.** SWAO does not phone home, collect usage data, or transmit workspace
  content to any Accenture server.
- **Binary integrity.** Release binaries are distributed with SHA256 checksums in
  `dist-bin/SHA256SUMS` and signed GitHub Releases.

---

## Security updates

Security fixes are announced via:

- **GitHub Releases** - release notes indicate when a release addresses a security issue
- **GitHub Discussions / Announcements** - significant vulnerabilities announced in the
  Announcements category
- **GitHub Security Advisories** - published at fix time with CVE if applicable
