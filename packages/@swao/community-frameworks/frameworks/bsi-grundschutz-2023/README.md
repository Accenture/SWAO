<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     BSI IT-Grundschutz 2023 -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# BSI IT-Grundschutz 2023 -- SWAO Community Framework

**Framework ID:** `BSI_GRUNDSCHUTZ_2023`
**Version:** IT-Grundschutz Kompendium Edition 2023 (published January 2023)
**Authority:** Bundesamt fuer Sicherheit in der Informationstechnik (BSI), Germany
**SWAO tier:** Community (bundled -- appears automatically in the TUI framework picker)
**Controls:** 105 controls across 27 Bausteine -- 72 Basis (B) + 33 Standard (S) requirements, 8 Schichten

## What this framework evaluates

BSI IT-Grundschutz is the German Federal Office for Information Security's comprehensive
methodology for systematically establishing, implementing, and maintaining information
security. Unlike BSI C5, which is cloud-specific, IT-Grundschutz covers the full ISMS
lifecycle and applies to on-premises, hybrid, and cloud workloads alike.

Edition 2023 organises 111 Bausteine (building blocks) across 10 Schichten (layers). This
SWAO community framework packages the workload-applicable subset: 105 controls from 27
Bausteine drawn from the ISMS, ORP, CON, OPS, DER, APP, SYS, and NET layers. v0.2.0
ships 72 mandatory Basis (B) and 33 recommended Standard (S) requirements. Hoher
Schutzbedarf (H) requirements and the full 111-Baustein coverage require manual expert
review and are excluded from automated assessment.

IT-Grundschutz is the recognised methodology for BSI Grundschutz Zertifizierung, is
extensively mapped to ISO/IEC 27001, and aligns closely with BSI C5 for cloud-layer
requirements.

## How to activate in SWAO

BSI_GRUNDSCHUTZ_2023 is bundled in the binary and appears automatically in the
TUI framework picker (the Compliance screen in the Setup Wizard). No install
step or `.swao.yml` edit is needed -- select it from the list and SWAO writes
`assessment.regimes_active` for you.

To add it alongside BSI C5 for cloud-layer cross-coverage, select both in the
picker or set directly in `.swao.yml`:

```yaml
assessment:
  regimes_active: [BSI_GRUNDSCHUTZ_2023, BSI_C5]
```

## Control layers (Schichten)

| Schicht | Bausteine | B controls | S controls | Focus |
|---|---|---|---|---|
| ISMS | ISMS.1 | 5 | 3 | Security management, policy, ISO appointment |
| ORP | ORP.1, ORP.2, ORP.4, ORP.5 | 10 | 3 | Organisation, personnel, IAM policy, compliance |
| CON | CON.1, CON.2, CON.3, CON.6, CON.8 | 12 | 4 | Cryptography, data protection, backup, SDLC |
| OPS | OPS.1.1.2, OPS.1.1.3, OPS.1.1.5, OPS.2.2, OPS.2.3 | 14 | 4 | Change, patching, backup, cloud services |
| DER | DER.1, DER.2.1, DER.3.1, DER.4 | 10 | 5 | Detection, incident response, audit, BCP |
| APP | APP.3.1, APP.4.3, APP.4.4 | 9 | 5 | Web apps, databases, container orchestration |
| SYS | SYS.1.1, SYS.1.6 | 6 | 4 | Server hardening, container security |
| NET | NET.1.1, NET.3.2, NET.3.3 | 6 | 5 | Network architecture, firewall, VPN |

## Severity mapping

| Grundschutz requirement class | SWAO severity | Notes |
|---|---|---|
| Basis (B) | high | Mandatory; included in v0.1.0 |
| Standard (S) | medium | Recommended; added in v0.2.0 |
| Hoher Schutzbedarf (H) | excluded | Manual expert review only |

## Cross-framework mappings

Controls carry `maps_to` references to GDPR, ISO 27001, BSI C5, DORA, and SOC 2,
enabling SWAO's heatmap to surface cross-framework coverage gaps. The
`cross_mapping_hints` in `framework-meta.yaml` list all frameworks with
significant overlap.

## Customising this framework

To extend or override controls for a specific workspace, copy the folder
`swao/packages/@swao/community-frameworks/frameworks/bsi-grundschutz-2023/` into
`<workspace>/catalogs/community/bsi-grundschutz-2023/` and edit the local copy.
SWAO loads the workspace copy in preference to the bundled version. See
`CONTRIBUTING.md` for the authoring guide.

## Authoritative source

IT-Grundschutz Kompendium Edition 2023 is available from the BSI at no charge:

- Download: https://www.bsi.bund.de/SharedDocs/Downloads/EN/BSI/Grundschutz/International/bsi_it_gs_comp_2023.html
- Overview: https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/IT-Grundschutz/IT-Grundschutz-Kompendium/it-grundschutz-kompendium_node.html

Control descriptions in this catalogue paraphrase requirement text for SWAO machine
ingestion. Verify accuracy by locating the cited Baustein and requirement identifier
in the source publication. No legal advice is provided.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
