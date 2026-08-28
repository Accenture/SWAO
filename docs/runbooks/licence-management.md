# Licence Management

SWAO ships in three tiers -- Community, Consultant, and Enterprise -- each unlocking additional capabilities. This runbook covers requesting a licence, activating it, handling offline environments, checking status, and understanding what each tier includes.

---

## Tier comparison

| Feature | Community | Consultant | Enterprise |
|---|---|---|---|
| Core assessment (static, compliance, context passes) | Yes | Yes | Yes |
| LLM pass (dynamic analysis) | Yes | Yes | Yes |
| PDF report generation | No | Yes | Yes |
| Report gallery + publish | No | Yes | Yes |
| HTML Editor (interactive evidence editor, swao publish --edit) | No | No | Yes |
| Power BI export bundle | No | No | Yes |
| Custom compliance frameworks | No | Yes | Yes |
| Multi-app portfolio assessments | No | No | Roadmap |
| Enterprise SSO + audit log | No | No | Yes |
| Priority support SLA | No | Yes | Yes |

Community edition runs without any licence key. All capabilities are available locally with no registration required.

---

## 1. Check current licence status

```bash
swao license status
```

Example output:

```
Licence tier:    Community
Key:             (none)
Expires:         n/a
Features:        core, llm
```

The `swao health-check` command also prints licence status as one of its probes.

---

## 2. Upgrade from Community to Consultant

### Step 1 -- request a licence token

```bash
swao license request
```

This command prints a token to stdout that encodes your machine fingerprint. Copy the full token.

### Step 2 -- send the token to the SWAO team

Email the token to the address provided on the SWAO releases page or in your procurement agreement. The team generates an activation key tied to your token.

### Step 3 -- activate the key

```bash
swao license activate <activation-key>
```

On success, `swao license status` reports the new tier and expiry date.

---

## 3. Offline activation

For machines without outbound internet access, use the export/import workflow:

```bash
# On the internet-connected machine: generate the request file
swao license request --export /tmp/swao-licence-request.json

# Transfer the JSON file to the machine that can reach the SWAO licensing service
# then on that machine:
swao license import --key <activation-key> --output /tmp/swao-licence-token.json

# Transfer the token file back to the air-gapped machine and apply it
swao license import /tmp/swao-licence-token.json
```

The licence token is a signed JSON payload. It does not contain personal data beyond the machine fingerprint embedded during `request`.

---

## 4. Renewal

Licences carry an expiry date. When a licence is within 30 days of expiry, `swao health-check` prints a yellow warning on the licence probe. When expired, the probe turns red and Consultant/Enterprise features are gated until renewal.

```bash
# Check days remaining
swao license status

# Renew: follow the same request -> activate flow as initial activation
swao license request
# email the token, receive new key
swao license activate <new-key>
```

Community edition never expires and does not require renewal.

---

## 5. Licence file location

The activated licence is stored locally at:

- **Linux / macOS:** `~/.swao/licence.json`
- **Windows:** `%APPDATA%\swao\licence.json`

Do not manually edit this file. If it becomes corrupted, delete it and re-activate.

```bash
# Linux/macOS
rm ~/.swao/licence.json
swao license activate <key>

# Windows (PowerShell)
Remove-Item "$env:APPDATA\swao\licence.json"
swao license activate <key>
```

---

## 6. Enterprise licences

Enterprise licences are provisioned organisation-wide via a licence server. Contact the SWAO team for the enterprise onboarding guide. The `swao license` subcommands above apply equally; the difference is that the activation key is issued per-organisation rather than per-user.

---

## 7. Request a licence

To request a Consultant or Enterprise licence, email the SWAO team with your machine
fingerprint token.

### Step 1 -- generate your machine fingerprint

```bash
swao machine-id
```

This prints a short token that encodes your machine identity without any personal data.
Copy the full token string.

### Step 2 -- send the request

Email [swao-tool@accenture.com](mailto:swao-tool@accenture.com?subject=SWAO%20Consultant%20Licence%20Request) with:

- The machine fingerprint token from Step 1.
- Your intended use: Consultant engagement or Enterprise deployment.
- Your organisation name (for Enterprise licences).

**Pre-filled email links:**

- [Request Consultant licence](mailto:swao-tool@accenture.com?subject=SWAO%20Consultant%20Licence%20Request)
- [Request Enterprise licence](mailto:swao-tool@accenture.com?subject=SWAO%20Enterprise%20Licence%20Request)

The SWAO team will respond within two business days with an activation key.

### Step 3 -- activate

```bash
swao license activate <activation-key>
```

Verify the result:

```bash
swao license status
```

---

## 8. Frequently asked questions

**What counts as a machine?**

A licence is tied to the machine fingerprint generated by `swao machine-id`. This fingerprint
is derived from stable hardware identifiers. A virtual machine, container host, or CI runner
each count as a separate machine.

**Can I use one licence on multiple machines?**

Consultant licences are single-machine. Enterprise licences cover an organisation-wide
deployment -- contact the team to discuss the number of seats included.

**Is there a trial period?**

Community edition is free and unrestricted. It covers the full assessment engine, LLM
integration, and HTML publication. Consultant and Enterprise features (PDF reports,
PowerBI templates, portfolio dashboards) are available for evaluation on request --
include "trial" in your licence request email subject.

**What happens when a licence expires?**

`swao health-check` prints a warning when the licence is within 30 days of expiry and a
blocking notice when expired. Core Community features remain available. Consultant and
Enterprise features are gated until renewal. Renew by following the same request and
activate workflow as the initial activation.
