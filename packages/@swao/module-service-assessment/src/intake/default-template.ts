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
 * Default intake template (Design 103 §3.2): header names, not fixed column
 * letters. Without `--mapping`, each sheet's header row is matched against
 * these aliases and resolved into a ColumnMap, so the parser has one code path.
 */

import { type ColumnMap, type FieldKey, type PiiColumn, indexToColumn, isPiiHeader } from '../schema/column-map.schema.js';

/** Lower-cased header aliases per field (English template names plus common German variants). */
export const DEFAULT_HEADER_ALIASES: Readonly<Partial<Record<FieldKey, readonly string[]>>> = {
  // #3210: English and German labels for every mapped field.
  id: ['app id', 'vm', 'id', 'server', 'hostname', 'app-id', 'anwendungs-id', 'kennung'],
  name: ['app name', 'application', 'anwendung', 'name', 'app-name', 'anwendungsname', 'applikation', 'bezeichnung'],
  vendor_name: ['vendor', 'hersteller', 'manufacturer', 'anbieter', 'lieferant'],
  vendor_version: ['version', 'versionsstand'],
  vendor_url: ['vendor website', 'url', 'website', 'webseite', 'hersteller website', 'hersteller-website'],
  vendor_type: ['assessment type', 'vendor type', 'bewertungstyp', 'betriebsmodell', 'herstellertyp'],
  // "Hersteller Support" is a personal-data column (contact), so the German
  // labels for an active support contract avoid that phrase.
  vendor_support_active: ['vendor support active', 'support aktiv', 'wartung aktiv', 'wartungsvertrag aktiv'],
  contract_expiry: ['contract expiry', 'vertragsende', 'vertragsablauf'],
  os: ['os', 'operating system', 'betriebssystem'],
  os_eol: ['os support status', 'os supportstatus', 'os support-status', 'betriebssystem supportstatus'],
  // #3168: "Active Memory" must not fall into memory_mb (G-04 needs active_memory_mb)
  active_memory_mb: ['active memory (mb)', 'active memory', 'aktiver speicher', 'aktiver arbeitsspeicher'],
  memory_mb: ['memory (mb)', 'memory', 'ram (mb)', 'ram', 'arbeitsspeicher'],
  cpu_cores: ['cpu cores', 'cpus', 'cpu', 'vcpu', 'vcpus', 'cpu-kerne', 'cpu kerne', 'prozessoren', 'anzahl cpu'],
  disk_count: ['disks', 'disk count', 'festplatten', 'anzahl festplatten'],
  total_disk_mib: ['total disk capacity mib', 'total disk (mib)', 'disk capacity mib', 'festplattenkapazität mib', 'gesamtspeicher mib'],
  total_disk_gb: ['total disk (gb)', 'disk (gb)', 'total disk capacity gb', 'festplattenkapazität (gb)', 'gesamtspeicher (gb)', 'speicherplatz (gb)'],
  ip: ['ip', 'ip address', 'ip-adresse'],
  network_zone: ['network zone', 'netzwerkzone', 'netzzone'],
  auth_method: ['authentication', 'authentication method', 'authentifizierung', 'anmeldeverfahren'],
  backup_enabled: ['backup / dr', 'backup', 'datensicherung'],
  sla_uptime: ['sla uptime (%)', 'sla uptime', 'sla verfügbarkeit (%)', 'sla verfügbarkeit', 'verfügbarkeit (%)', 'verfügbarkeit'],
  business_domain: ['department', 'fachbereich', 'abteilung'],
  business_function: ['function', 'app-funktion', 'app funktion', 'app function', 'funktion', 'anwendungsfunktion'],
  user_count: ['user count', 'number of users', 'anzahl benutzer', 'benutzeranzahl', 'anzahl nutzer'],
  criticality: ['criticality', 'business criticality', 'kritikalität', 'geschäftskritikalität'],
  annual_cost_eur: ['annual cost (eur)', 'annual cost', 'jährliche kosten (eur)', 'jährliche kosten', 'jahreskosten'],
  license_type: ['license type', 'licence type', 'lizenztyp', 'lizenzart', 'lizenzmodell'],
  health_data: ['contains health data', 'gesundheitsdaten', 'enthält gesundheitsdaten'],
  data_pii: ['contains personal data (pii)', 'contains personal data', 'personenbezogene daten', 'enthält personenbezogene daten'],
  data_subjects: ['data subjects', 'betroffene personen', 'betroffenengruppen'],
  data_categories: ['data categories', 'datenkategorien'],
  data_classification: ['data classification', 'datenklassifizierung', 'schutzbedarf'],
  data_residency: ['data residency', 'datenstandort', 'datenresidenz'],
  subprocessors: ['sub-processors', 'subprocessors', 'unterauftragsverarbeiter'],
  gdpr_art9: ['gdpr art.9 health data', 'gdpr art.9', 'dsgvo art.9 gesundheitsdaten', 'dsgvo art.9', 'dsgvo art. 9'],
  hipaa_phi: ['hipaa phi'],
  regulatory: ['regulatory obligations', 'regulatorische anforderungen', 'regulatorik'],
  mdr_class: ['mdr / ivdr classification', 'mdr class', 'mdr-klasse', 'mdr klasse', 'medizinprodukteklasse'],
  migration_candidate: ['migration candidate', 'migration', 'migrationskandidat'],
  migration_project_vendor: ['migrationsprojekt mit hersteller', 'migration project with vendor', 'vendor migration project'],
  ams_sovereign_cloud: ['ams sovereign cloud'],
  gartner_time: ['gartner time', 'time category', 'time-einstufung', 'time einstufung', 'time-kategorie'],
  last_audit_date: ['last security audit', 'last audit', 'letztes sicherheitsaudit', 'letztes audit'],
  integrations_raw: ['integration dependencies', 'integrations', 'kis-anbindung', 'kis anbindung', 'schnittstellen'],
};

const LIST_SEPARATORS: Partial<Record<FieldKey, string>> = {
  data_subjects: ',',
  data_categories: ',',
  subprocessors: ',',
  regulatory: ',',
  business_domain: '/',
};

/**
 * Prefix matching (#3168): a header such as "OS according to the configuration
 * file" or "AMS Sovereign Cloud Ja / Nein" starts with an alias followed by a
 * word boundary. "OSI layer" does not match "os"; "Migrationsprojekt" does not
 * match "migration".
 */
function startsWithAlias(header: string, alias: string): boolean {
  if (!header.startsWith(alias) || header.length === alias.length) return false;
  return /[\s(\[:\/,;.]/.test(header.charAt(alias.length));
}

/** Which boolean presence flag a PII column feeds, from its declared reason or header. */
export type PiiKind = 'contact' | 'phone' | 'email';

export function piiKindOf(p: Pick<PiiColumn, 'reason' | 'stored_as'>, header = ''): PiiKind {
  const hint = `${p.stored_as ?? ''} ${p.reason} ${header}`.toLowerCase();
  if (/phone|telefon|\btel\b|mobil/.test(hint)) return 'phone';
  if (/mail/.test(hint)) return 'email';
  return 'contact';
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Resolve a header row into a ColumnMap. Headers that look like personal data
 * (contact, phone, email) become pii_columns. Returns null when no identity
 * column is present (the sheet is not an intake sheet).
 */
export function resolveDefaultMap(headers: ReadonlyMap<number, string>): ColumnMap | null {
  const fields: Record<string, Record<string, unknown>> = {};
  const pii: Array<{ col: string; reason: string }> = [];
  const taken = new Set<number>();

  for (const [index, header] of headers) {
    if (isPiiHeader(header)) {
      pii.push({ col: indexToColumn(index), reason: norm(header) });
      taken.add(index);
    }
  }

  // Pass 1: exact matches for every field; pass 2: prefix matches for the
  // fields still unmapped, on columns no exact match has taken (#3168).
  const aliasEntries = Object.entries(DEFAULT_HEADER_ALIASES) as Array<[FieldKey, readonly string[]]>;
  for (const match of [(h: string, a: string) => h === a, startsWithAlias]) {
    for (const [key, aliases] of aliasEntries) {
      if (fields[key]) continue;
      for (const alias of aliases) {
        const hit = [...headers].find(([i, h]) => !taken.has(i) && match(norm(h), alias));
        if (hit) {
          const sep = LIST_SEPARATORS[key];
          fields[key] = { col: indexToColumn(hit[0]), ...(sep ? { multi_value_separator: sep } : {}) };
          taken.add(hit[0]);
          break;
        }
      }
    }
  }

  if (!fields['id']) return null;
  // Without a separate name column the identity cell is the combined
  // "ID (Name) notes" form of Design 103 §3.3.2 (#3167).
  if (!fields['name']) {
    fields['id_name_combined'] = { col: (fields['id'] as { col: string }).col, split_on: '(', strip_closing: ')', strip_flags: true };
    delete fields['id'];
  }
  // Built directly rather than via parseColumnMap: an explicit column map must map
  // `os`, but the default template tolerates a missing OS column (§18.3: only the
  // identity column is mandatory); rows then get MANDATORY_FIELD_MISSING signals.
  return {
    version: '1.0',
    source: { header_row: 1, data_start_row: 2 },
    fields: fields as ColumnMap['fields'],
    pii_columns: pii,
  };
}
