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
 * English canonical terms for intake values (#3210).
 *
 * Intake workbooks are client-authored and often German or mixed. SWAO's own
 * vocabulary is English, so at scaffold time enumerated values (criticality,
 * Gartner TIME, data classification) map to English canonical values, and
 * department / function names map through a glossary (product default here,
 * workspace override in `.swao.yml` `service_portfolio.glossary`). The
 * original intake wording is kept next to the canonical value
 * (`domain_source`, ...) whenever the two differ. Unmapped glossary values are
 * kept verbatim and reported in one scaffold warning so the analyst can extend
 * the glossary. Free-text notes are never translated.
 */

/** Lower-cased key: trimmed, single spaces. */
export function termKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Criticality: canonical scale used by the APM rules (critical / high / medium / low). */
export const CRITICALITY_TERMS: Readonly<Record<string, string>> = {
  critical: 'critical', kritisch: 'critical', 'sehr hoch': 'critical', 'geschäftskritisch': 'critical', 'geschaeftskritisch': 'critical', 'mission critical': 'critical',
  high: 'high', hoch: 'high',
  medium: 'medium', mittel: 'medium', normal: 'medium',
  low: 'low', niedrig: 'low', gering: 'low',
};

/** Gartner TIME quadrant: canonical capitalised English names. */
export const TIME_TERMS: Readonly<Record<string, string>> = {
  tolerate: 'Tolerate', tolerieren: 'Tolerate',
  invest: 'Invest', investieren: 'Invest',
  migrate: 'Migrate', migrieren: 'Migrate',
  eliminate: 'Eliminate', eliminieren: 'Eliminate', abschalten: 'Eliminate',
};

/** Data classification: canonical English labels. */
export const CLASSIFICATION_TERMS: Readonly<Record<string, string>> = {
  public: 'Public', 'öffentlich': 'Public', oeffentlich: 'Public',
  internal: 'Internal', intern: 'Internal',
  confidential: 'Confidential', vertraulich: 'Confidential',
  'strictly confidential': 'Strictly Confidential', 'streng vertraulich': 'Strictly Confidential',
  secret: 'Secret', geheim: 'Secret',
};

/**
 * Product default glossary for department and function names (German -> English,
 * British spelling). Keys are lower-cased. English canonical values map to
 * themselves via GLOSSARY_CANONICAL so an English intake raises no warning.
 */
export const DEFAULT_GLOSSARY: Readonly<Record<string, string>> = {
  // Clinical departments
  radiologie: 'Radiology',
  labor: 'Laboratory',
  labormedizin: 'Laboratory Medicine',
  kardiologie: 'Cardiology',
  chirurgie: 'Surgery',
  pathologie: 'Pathology',
  apotheke: 'Pharmacy',
  notaufnahme: 'Emergency Department',
  'zentrale notaufnahme': 'Emergency Department',
  intensivstation: 'Intensive Care',
  intensivmedizin: 'Intensive Care',
  pflege: 'Nursing',
  onkologie: 'Oncology',
  neurologie: 'Neurology',
  'gynäkologie': 'Gynaecology',
  gynaekologie: 'Gynaecology',
  'pädiatrie': 'Paediatrics',
  paediatrie: 'Paediatrics',
  kinderklinik: 'Paediatrics',
  'anästhesie': 'Anaesthesia',
  anaesthesie: 'Anaesthesia',
  nuklearmedizin: 'Nuclear Medicine',
  strahlentherapie: 'Radiotherapy',
  'orthopädie': 'Orthopaedics',
  orthopaedie: 'Orthopaedics',
  urologie: 'Urology',
  dermatologie: 'Dermatology',
  psychiatrie: 'Psychiatry',
  'innere medizin': 'Internal Medicine',
  medizintechnik: 'Medical Technology',
  // Administrative departments
  verwaltung: 'Administration',
  patientenverwaltung: 'Patient Administration',
  personal: 'Human Resources',
  personalwesen: 'Human Resources',
  personalabteilung: 'Human Resources',
  finanzen: 'Finance',
  finanzbuchhaltung: 'Financial Accounting',
  buchhaltung: 'Accounting',
  abrechnung: 'Billing',
  einkauf: 'Procurement',
  logistik: 'Logistics',
  'geschäftsführung': 'Executive Management',
  geschaeftsfuehrung: 'Executive Management',
  'qualitätsmanagement': 'Quality Management',
  qualitaetsmanagement: 'Quality Management',
  recht: 'Legal',
  rechtsabteilung: 'Legal',
  datenschutz: 'Data Protection',
  haustechnik: 'Facility Management',
  technik: 'Engineering',
  archiv: 'Archive',
  'küche': 'Catering',
  kueche: 'Catering',
  edv: 'IT',
  informatik: 'IT',
  'it-abteilung': 'IT',
  // Functions
  dokumentation: 'Documentation',
  befundung: 'Diagnostic Reporting',
  terminplanung: 'Scheduling',
  bildarchivierung: 'Image Archiving',
  dateiablage: 'File Storage',
  kommunikation: 'Communication',
  zeiterfassung: 'Time Recording',
  dienstplanung: 'Rostering',
  lohnabrechnung: 'Payroll',
  'überwachung': 'Monitoring',
  ueberwachung: 'Monitoring',
  datensicherung: 'Backup',
  sicherheit: 'Security',
};

/** English canonical values of every built-in map, so an English intake maps to itself. */
const CANONICAL_ENGLISH: ReadonlyMap<string, string> = new Map(
  [...Object.values(DEFAULT_GLOSSARY)].map((v) => [termKey(v), v] as const),
);

export interface TermResult {
  /** English canonical value, or the original when unmapped. */
  value: string;
  /** Original intake wording when it differs from `value`; undefined otherwise. */
  source?: string;
  /** False when the value is not in the map (kept verbatim). */
  mapped: boolean;
}

/** Map one value through `terms` (lower-cased keys). */
export function canonicalTerm(raw: string, terms: Readonly<Record<string, string>>): TermResult {
  const original = raw.trim();
  const hit = terms[termKey(original)];
  if (hit === undefined) return { value: original, mapped: false };
  return hit === original ? { value: hit, mapped: true } : { value: hit, source: original, mapped: true };
}

/**
 * Build the effective glossary: product defaults, English canonical values
 * mapping to themselves, then the workspace override (`service_portfolio.glossary`,
 * source term -> English term; the override wins). Invalid entries are ignored.
 */
export function resolveGlossary(override?: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_GLOSSARY };
  for (const [k, v] of CANONICAL_ENGLISH) if (!(k in out)) out[k] = v;
  if (override && typeof override === 'object' && !Array.isArray(override)) {
    for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim() && k.trim()) {
        out[termKey(k)] = v.trim();
        // The override's English value is canonical too.
        if (!(termKey(v) in out)) out[termKey(v)] = v.trim();
      }
    }
  }
  return out;
}
