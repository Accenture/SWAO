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
  // #3405: Pass 26 code health.
  code_health:           { summary: 'Code health (Pass 26): deterministic file-level worklist (size, complexity, duplication, hard-coded IPs and URLs, TODO markers) and four KPIs. Local, no LLM; no external tool unless lizard / jscpd are opted in (assessment.code_health.tools). Included in "All passes".', tip: 'Production code only: test and generated files are counted, not measured. File owners come from CODEOWNERS when present.' },
  // #3419: default secret scan; the full malware scan supersedes it.
  secret_scan:           { summary: 'Default secret scan (Pass 14, Gitleaks only): finds hard-coded passwords, tokens and keys in the source tree. Values are masked in every output. Included in "All passes".', tip: 'Install Gitleaks on PATH; without it the run records MAL-00 and the publication lists the pass under "Passes not executed". Set passes.malware.tools.gitleaks.scan_history: true to scan git history too. Selecting the full malware scan (14-malware) replaces this pass.' },
  malware_scanning:      { summary: 'Optional: full Pass 14 scan of source dependencies and binaries using OSS tools (Gitleaks, OSV-Scanner, ClamAV, YARA, ORT). Opt-in only -- not included in "All passes"; replaces the default secret scan when selected.', tip: 'Selecting this pass auto-writes a passes.malware block in .swao.yml with default tool settings. Enable ORT under passes.malware.tools.ort.enabled. Adds significant run time; run separately after the core assessment.' },
};
