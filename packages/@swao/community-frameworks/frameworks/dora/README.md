<!--
// =======================================================================
//
//                          S  W  A  O
//
//     Sovereign Workload Assessment and Onboarding
//     DORA -- Community Framework
//
//     Community Edition  -  Apache 2.0
//
//     Website       :  https://steady-echo-yp4z.here.now/
//     Technical Docs:  https://accenture.github.io/SWAO/en/
//     Source Code   :  https://github.com/Accenture/SWAO
//
// =======================================================================
-->

# DORA -- SWAO Community Framework

**Framework ID:** `DORA`
**Version:** EU Regulation 2022/2554 -- applicable from 17 January 2025
**Authority:** European Parliament and Council of the European Union
**SWAO tier:** Community (install required -- `swao framework install DORA`)
**Controls:** Digital Operational Resilience Act controls (PoC depth; deeper catalogue in progress)

## What this framework evaluates

DORA (Digital Operational Resilience Act) assesses whether a financial sector workload meets
the ICT risk management, incident reporting, operational resilience testing, and third-party
ICT provider management obligations of EU Regulation 2022/2554. DORA applies to banks,
insurance undertakings, investment firms, crypto-asset service providers, and their critical
ICT third-party providers operating in the EU. Cloud migration projects that move financial
services workloads to sovereign cloud must demonstrate DORA compliance from January 2025.

## How to activate in SWAO

Install the framework, then add to your workspace `.swao.yml`:

```bash
swao framework install DORA
```

```yaml
compliance:
  frameworks: [DORA]
```

## Control domains

| Domain | Key articles | Focus |
|---|---|---|
| ICT risk management | Art. 5-16 | Governance, risk framework, ICT strategy, policies |
| ICT-related incident reporting | Art. 17-23 | Classification, notification to competent authorities |
| Digital operational resilience testing | Art. 24-27 | TLPT, vulnerability assessments, penetration testing |
| ICT third-party risk | Art. 28-44 | Contractual requirements, oversight of critical providers |
| Information sharing | Art. 45 | Cyber threat intelligence arrangements |

## Customising this framework

```bash
swao framework install DORA
```

The installed copy at `catalogs/community/dora/controls.yaml` overrides the bundled
version. See `CONTRIBUTING.md` for the authoring guide.

**Note:** This is a PoC-depth packaging (5 controls). The full DORA text and EBA/ESMA/EIOPA
regulatory technical standards are available from EUR-Lex. A full-depth SWAO packaging is
tracked as a community contribution opportunity.

## Contributor

Helmut Schindlwick (Accenture SWAO team) -- https://github.com/Accenture/SWAO
https://github.com/Accenture/SWAO
