<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     BSI C5 -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# BSI C5 -- SWAO Community Framework

**Framework ID:** `BSI_C5`
**Version:** BSI C5:2020
**Authority:** Bundesamt fuer Sicherheit in der Informationstechnik (BSI), Germany
**SWAO tier:** Community (install required -- `swao framework install BSI_C5`)
**Controls:** 62 Basic Criteria controls across all 17 C5:2020 domains

## What this framework evaluates

BSI C5 (Cloud Computing Compliance Criteria Catalogue) assesses whether a cloud workload
meets the requirements of the German Federal Office for Information Security's cloud security
baseline. Controls cover organisational security, physical security, personnel, identity and
access management, cryptography, communication security, incident management, availability,
supplier relationships, and compliance. C5 attestation is required for cloud services
targeting German federal agencies and is strongly recommended for KRITIS-regulated sectors.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install BSI_C5
```

```yaml
compliance:
  frameworks: [BSI_C5]
```

## Control domains

| Domain | Code | Controls | Focus |
|---|---|---|---|
| Organisational Information Security | OIS | 5 | Policies, roles, risk management, supplier security |
| Physical Security | PRY | 4 | Data centre access, environmental controls, media disposal |
| Human Resources Security | HRS | 4 | Vetting, awareness training, termination procedures |
| Identity and Access Management | IDM | 6 | IAM policies, MFA, PAM, access reviews, JML process |
| Cryptography | CRY | 4 | Key management, encryption at rest, TR-02102 compliance |
| Communication Security | COS | 4 | Network segmentation, firewall management, remote access |
| Operations | OPS | 6 | Change management, patching, asset inventory, hardening, logging |
| Availability and Resilience | AVL | 4 | BCP, RTO/RPO, geographic redundancy, backup |
| Procurement and Development | DEV | 4 | Secure SDLC, procurement security, code review, disclosure |
| Incident Management | INM | 4 | IRP, classification, BSI notification, post-incident review |
| Security Incident Management | SIM | 3 | SIEM, forensics, threat intelligence |
| Compliance | COM | 3 | Compliance register, internal audit, C5 attestation |
| Portability and Interoperability | PSS | 2 | Data export, service termination |
| Business Continuity Planning | BCP | 2 | Crisis communication, supplier exit strategy |
| Data Security | DAT | 4 | Classification, data residency, deletion, DPAs |
| Personal Information / Privacy | PI | 3 | Privacy by design, data subject rights, encrypted transmission |

**Total: 62 controls across 16 active domains** (OIS through PI).

## Customising this framework

```bash
swao framework install BSI_C5
```

The installed copy at `catalogs/community/bsi-c5/controls.yaml` overrides the bundled
version. See `CONTRIBUTING.md` for the authoring guide.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
