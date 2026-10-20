// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Service assessment module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

/**
 * SWAO_APM scoring rules (Design 103 §7, G-07, #3099-#3101).
 *
 * Each SWAO_APM control binds to a rule through `evidence_basis: [{ apm_export: <rule> }]`.
 * A rule maps evidence already produced by the service flow (intake fields,
 * research stubs, Phase 3 DATA/CRYPTO signals) to a 0-100 score on the
 * HEALTH scale: 100 = healthy / low concern, 0 = unhealthy / high concern.
 * A rule returns null when its evidence is absent; the control is then
 * "unknown" and excluded from its domain score (never defaulted to pass or fail).
 */

export interface ApmSignal { id: string; severity?: string; outcome?: string; derivation: string }

/** Everything the rules can read, gathered once per app. */
export interface ApmEvidence {
  app: Record<string, any>;
  cve: Record<string, any> | null;
  eol: Record<string, any> | null;
  vt: Record<string, any> | null;
  bsi: Record<string, any> | null;
  /** Signals from the latest service run (DATA, CRYPTO, ...), or null when no run exists. */
  runSignals: ApmSignal[] | null;
  /** Whether the latest run executed a pass key. */
  ranPasses: string[];
  /** Pass 25 BINARY signals (`wsp/signals/binary-signals.json`), or null when no analysis ran. */
  binarySignals?: Array<{ code: string; severity?: string }> | null;
  now: Date;
}

export type ApmRule = (e: ApmEvidence) => number | null;

const get = (o: Record<string, any> | null | undefined, path: string): any =>
  path.split('.').reduce<any>((acc, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), o ?? undefined);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const present = (v: unknown) => v !== null && v !== undefined && v !== '';

function monthsUntil(dateIso: unknown, now: Date): number | null {
  if (typeof dateIso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dateIso)) return null;
  return (Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`) - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function cryptoFinding(e: ApmEvidence, type: string): number | null {
  if (!e.ranPasses.includes('crypto') || !e.runSignals) return null;
  return e.runSignals.some((s) => s.id.startsWith('CRYPTO-') && s.derivation.includes(`CRYPTO.${type}`)) ? 0 : 100;
}

export const RESEARCHED = (b: Record<string, any> | null) => !!b && !b['error'] && !b['skipped_reason'] && !b['note'];

/** True when the intake column layout mapped `field`; unknown for apps scaffolded before #3196. */
const intakeMapped = (e: ApmEvidence, field: string): boolean | null => {
  const f = get(e.app, 'intake.fields');
  return Array.isArray(f) ? f.includes(field) : null;
};

export const APM_RULES: Readonly<Record<string, ApmRule>> = {
  // ---- APM-TCH technical health
  os_eol_status: (e) => {
    const isEol = get(e.eol, 'is_eol');
    if (typeof isEol !== 'boolean') return null;
    if (!isEol) return 100;
    return get(e.eol, 'extended_support_until') ? 30 : 0;
  },
  os_eol_horizon: (e) => {
    const m = get(e.eol, 'months_until_eol');
    if (!isNum(m)) return null;
    if (m <= 0) return 0;
    if (m < 12) return 20;
    if (m < 18) return 40;
    if (m < 36) return 70;
    return 100;
  },
  cve_critical_open: (e) => {
    if (!RESEARCHED(e.cve)) return null;
    const n = get(e.cve, 'critical_count');
    return isNum(n) ? (n === 0 ? 100 : n === 1 ? 40 : 10) : null;
  },
  cve_high_open: (e) => {
    if (!RESEARCHED(e.cve)) return null;
    const n = get(e.cve, 'high_count');
    return isNum(n) ? (n === 0 ? 100 : n <= 2 ? 60 : 30) : null;
  },
  kev_match: (e) => (RESEARCHED(e.cve) ? (get(e.cve, 'kev_match') === true ? 0 : 100) : null),
  patch_availability: (e) => {
    const p = get(e.cve, 'patch_available');
    return p === true ? 100 : p === 'partial' ? 60 : p === false ? 20 : null;
  },
  os_family_supported: (e) => {
    const c = get(e.app, 'os_class');
    if (!present(c)) return null;
    return /SOLARIS/.test(String(c)) ? 20 : 100;
  },
  product_version_known: (e) => (present(get(e.app, 'vendor.version')) ? 100 : 50),
  binary_runtime_current: (e) => {
    if (!e.binarySignals) return null;
    return e.binarySignals.some((s) => s.code === 'BINARY.LEGACY_RUNTIME') ? 20 : 100;
  },

  // ---- APM-SEC security posture
  weak_crypto: (e) => cryptoFinding(e, 'WEAK_ALGORITHM'),
  cleartext_endpoints: (e) => cryptoFinding(e, 'CLEARTEXT_ENDPOINT'),
  hardcoded_credentials: (e) => cryptoFinding(e, 'HARDCODED_SECRET'),
  expired_certificates: (e) => cryptoFinding(e, 'EXPIRED_CERT'),
  bsi_advisories: (e) => {
    // #3196: only a completed feed match is evidence; no lookup is unknown, not 100.
    if (!e.bsi || e.bsi['error'] || e.bsi['note'] || !isNum(get(e.bsi, 'alert_count'))) return null;
    if (get(e.bsi, 'alert_count') === 0) return 100;
    const sev = get(e.bsi, 'highest_severity');
    return sev === 'kritisch' ? 0 : sev === 'hoch' ? 30 : sev === 'mittel' ? 60 : sev === 'niedrig' ? 80 : 100;
  },
  vt_detection: (e) => {
    const m = get(e.vt, 'malicious');
    return isNum(m) ? (m === 0 ? 100 : m <= 2 ? 50 : 0) : null;
  },

  // ---- APM-VND vendor health
  vendor_identified: (e) => {
    const n = get(e.app, 'vendor.name');
    return present(n) && n !== '[contact-name-redacted]' ? 100 : 30;
  },
  vendor_support_active: (e) => {
    const v = get(e.app, 'vendor.support_active');
    return v === true ? 100 : v === false ? 0 : null;
  },
  support_contact_available: (e) => {
    const v = get(e.app, 'vendor');
    if (!v) return null;
    return v['support_contact_present'] || v['support_phone_present'] || v['support_email_present'] ? 100 : 40;
  },
  contract_currency: (e) => {
    const m = monthsUntil(get(e.app, 'vendor.contract_expiry'), e.now);
    if (m === null) return null;
    return m <= 0 ? 0 : m < 12 ? 50 : 100;
  },

  // ---- APM-DAT data governance
  data_classification_declared: (e) => (present(get(e.app, 'data.classification')) ? 100 : null),
  health_data_sensitivity: (e) => {
    const v = get(e.app, 'data.health_data') ?? get(e.app, 'data.gdpr_art9');
    return v === true ? 40 : v === false ? 100 : null;
  },
  personal_data_sensitivity: (e) => {
    const v = get(e.app, 'data.pii');
    return v === true ? 60 : v === false ? 100 : null;
  },
  data_flow_documented: (e) => (e.ranPasses.includes('data') && e.runSignals ? 100 : null),
  data_residency_declared: (e) => (present(get(e.app, 'data.residency')) ? 100 : null),
  subprocessors_declared: (e) => (Array.isArray(get(e.app, 'data.subprocessors')) ? 100 : null),

  // ---- APM-SOV sovereignty readiness
  sovereign_rating: (e) => {
    const r = get(e.app, 'sovereign_rating');
    return r === 'open-source' ? 100 : r === 'open-standard' ? 80 : r === 'proprietary' ? 40 : null;
  },
  sovereign_alternative_available: (e) => {
    const a = get(e.app, 'sovereign_alternatives');
    if (!Array.isArray(a)) return null;
    return a.length > 0 ? 100 : 40;
  },
  data_residency_eu: (e) => {
    const r = get(e.app, 'data.residency');
    if (!present(r)) return null;
    return /\b(eu|europe|germany|deutschland|de)\b/i.test(String(r)) ? 100 : 20;
  },

  // ---- APM-BIZ business criticality (value scale: high = business-important)
  business_criticality: (e) => {
    const c = String(get(e.app, 'business.criticality') ?? '').toLowerCase();
    return c === 'high' || c === 'critical' ? 90 : c === 'medium' ? 60 : c === 'low' ? 20 : null;
  },
  user_base: (e) => {
    const n = get(e.app, 'business.user_count');
    return isNum(n) ? (n >= 500 ? 90 : n >= 50 ? 60 : 30) : null;
  },
  operational_status_active: (e) => {
    const s = get(e.app, 'disposition.operational_status');
    return s === 'active' ? 100 : s === 'restricted' ? 60 : s ? 0 : null;
  },
  department_assigned: (e) => (present(get(e.app, 'business.domain')) ? 100 : 50),

  // ---- APM-STR strategic fit (value scale)
  analyst_time_signal: (e) => {
    const t = String(get(e.app, 'disposition.gartner_time') ?? '').toLowerCase();
    return t.startsWith('inv') ? 90 : t.startsWith('tol') ? 60 : t.startsWith('mig') ? 40 : t.startsWith('eli') ? 10 : null;
  },
  migration_intent: (e) => {
    const m = get(e.app, 'disposition.migration_candidate');
    return m === true ? 70 : m === false ? 50 : null;
  },

  // ---- APM-HW hardware and cost
  hardware_profile_known: (e) => (isNum(get(e.app, 'hardware.cpu_cores')) && isNum(get(e.app, 'hardware.memory_mb')) ? 100 : null),
  memory_utilisation: (e) => {
    const total = get(e.app, 'hardware.memory_mb');
    const active = get(e.app, 'hardware.active_memory_mb');
    if (!isNum(total) || !isNum(active) || total <= 0) return null;
    const u = active / total;
    return u === 0 ? null : u < 0.1 ? 50 : u > 0.9 ? 60 : 100;
  },
  cloud_cost_estimate: (e) => (isNum(get(e.app, 'hardware.est_cloud_cost_eur_mo')) ? 100 : null),

  // ---- APM-INT integration complexity (high = simple to move)
  integration_count: (e) => {
    const i = get(e.app, 'integrations');
    if (!Array.isArray(i)) return null;
    // #3196: an empty list only means "no integrations" when the intake had an integration column.
    if (i.length === 0 && intakeMapped(e, 'integrations_raw') !== true) return null;
    return i.length === 0 ? 100 : i.length <= 3 ? 70 : i.length <= 8 ? 40 : 20;
  },
  integration_documented: (e) => (Array.isArray(get(e.app, 'integrations')) && (get(e.app, 'integrations').length > 0 || present(get(e.app, 'integrations_notes'))) ? 100 : null),

  // ---- APM-MIG migration readiness
  migration_candidate_flag: (e) => {
    const m = get(e.app, 'disposition.migration_candidate');
    return m === true ? 100 : m === false ? 40 : null;
  },
  os_portability: (e) => {
    const c = String(get(e.app, 'os_class') ?? '');
    if (!c) return null;
    return /LINUX/.test(c) ? 100 : /WINDOWS/.test(c) ? 80 : 20;
  },
  vendor_type_cloud_ready: (e) => {
    const t = get(e.app, 'vendor_type');
    return t === 'saas' ? 100 : t === 'hybrid' ? 80 : t === 'on-premises' ? 50 : t === 'legacy' ? 20 : null;
  },
  sovereign_cloud_programme: (e) => (get(e.app, 'disposition.ams_sovereign_cloud') === true ? 100 : null),

  // ---- APM-REG compliance obligations (high = light obligations / well covered)
  regulatory_load: (e) => {
    const r = get(e.app, 'data.regulatory');
    if (!Array.isArray(r)) return null;
    return r.length === 0 ? 100 : r.length <= 2 ? 60 : 30;
  },
  gdpr_art9_scope: (e) => {
    const v = get(e.app, 'data.gdpr_art9');
    return v === true ? 40 : v === false ? 100 : null;
  },
  mdr_classification_known: (e) => {
    const regs = get(e.app, 'data.regulatory');
    const mdr = Array.isArray(regs) && regs.some((x: unknown) => String(x).toUpperCase() === 'MDR');
    if (!mdr) return null;
    return present(get(e.app, 'data.mdr_class')) ? 100 : 30;
  },
  audit_recency: (e) => {
    const m = monthsUntil(get(e.app, 'security.last_audit_date'), e.now);
    if (m === null) return null;
    return -m <= 12 ? 100 : -m <= 36 ? 60 : 20;
  },
};

export const APM_RULE_NAMES = Object.keys(APM_RULES);
