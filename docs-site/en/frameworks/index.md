---
title: Frameworks
---

# Compliance Frameworks

SWAO Community Edition ships with four built-in compliance frameworks. Additional frameworks
can be added via the community framework extension mechanism (see [Contributing](/en/contributing)).

## Built-in Frameworks

| Framework | ID | Controls | Domain |
|-----------|-----|---------|--------|
| [GDPR](/en/frameworks/gdpr) | `gdpr` | 46 | Data Protection (EU) |
| [HIPAA Security Rule](/en/frameworks/hipaa) | `hipaa` | 45 | Healthcare Data (US) |
| [AI 10 Pillars](/en/frameworks/ai-10-pillars) | `ai_10_pillars` | 30 | Responsible AI |
| [COBIT 5](/en/frameworks/cobit5) | `cobit_5` | 37 | IT Governance |
| [NIST SP 800-66 R2](/en/frameworks/nist-sp-800-66r2) | `nist_sp_800_66r2` | 66 | Healthcare Cybersecurity (US) |

## Listing Frameworks at Runtime

```bash
swao framework list
```

## Adding a Custom Framework

Community frameworks live in `controls/<slug>/` in the SWAO workspace. Each framework
requires two files:

- `framework-meta.yaml` -- display name, version, contributor block
- `controls.yaml` -- the control definitions

See [Contributing](/en/contributing) for the full contributor guide and schema reference.
