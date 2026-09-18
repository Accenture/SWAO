// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  App assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

export const PASS_DESCRIPTIONS: Record<string, { summary: string; tip?: string }> = {
  inventory_scan:      { summary: 'Building component inventory: packages, services, databases, IaC files, API surface.' },
  state_analysis:      { summary: 'Detecting stateful components: databases, Redis, queues, K8s config. Affects migration complexity.' },
  data_classification: { summary: 'Classifying data in models and APIs: PII, health records, financial data, GDPR-regulated fields.' },
  context_ingestion:   { summary: 'Reading wsp/inputs/ folder: CMDB records, architecture docs, incidents, FinOps data. Add files to wsp/inputs/ to enrich this pass.' },
  sbom_cve:            { summary: 'Building Software Bill of Materials and checking OSV vulnerability database for CVEs and EOL runtimes.' },
  twelve_factor:       { summary: 'Validating Twelve-Factor compliance: config externalisation, logging, stateless design, port binding.' },
  egress:              { summary: 'Mapping external service calls: cloud SDKs, analytics, CDNs, US-hosted SaaS -- checks data residency conflicts.' },
  crypto_posture:      { summary: 'Scanning cryptography: KDF strength (bcrypt/argon2), JWT mode, HTTPS enforcement, encryption at rest.' },
  synthesis:           { summary: 'AI synthesis: reads all 8 passes, produces 7R recommendation (Rehost/Replatform/Refactor/...) and sovereignty coverage score.', tip: 'Requires LLM API access. If this fails: verify API key in Credentials (7) and outbound HTTPS to the LLM endpoint.' },
  dynamic_analysis:    { summary: 'Playwright crawl: captures UI screenshots and JavaScript execution traces for dynamic analysis. Requires Chromium.', tip: 'Opt-in: only runs when dynamic is in the pass selection. Skipped automatically when --no-crawl is set or Chromium is absent.' },
  compliance_evaluation: { summary: 'LLM-driven compliance evaluation: maps signals to control outcomes (SATISFIED/PARTIAL/GAP) per selected regime. Feeds the Compliance, Auditor, and Risk PowerBI pages.', tip: 'Requires LLM API access. Without it every control falls back to UNKNOWN. Standard / Premium tier feature.' },
  block_assessments:     { summary: 'LLM-driven block assessments (Pass 12): evaluates 8 operational blocks -- Observability (logging/alerting), Licence Compliance (open-source risk), Testing Maturity (coverage/quality), Architecture (design patterns), Database (DB sizing/risk), Integration (API/event contracts), IAM (identity/RBAC), Disaster Recovery (RTO/RPO). Each block receives a scored verdict (STRONG/ADEQUATE/WEAK/MISSING). Feeds the Auditor PowerBI page.', tip: 'Requires LLM API access. Without it every block falls back to UNKNOWN.' },
  scope_analysis:        { summary: 'Mapping which SWAO-assessed services are in-scope for the active compliance frameworks. Determines the coverage denominator for the sovereignty score.' },
  malware_scanning:      { summary: 'Optional: scans source dependencies and binaries for known malicious patterns using OSS tools (Gitleaks, ORT). Opt-in only -- not included in "All passes".', tip: 'Selecting this pass auto-writes a passes.malware block in .swao.yml with default tool settings. Enable ORT under passes.malware.tools.ort.enabled. Adds significant run time; run separately after the core assessment.' },
};
