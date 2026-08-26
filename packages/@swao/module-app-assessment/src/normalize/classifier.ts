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

// Rule-based file classifier for the `swao normalize` command (#0442).
//
// Classification is purely pattern-matching on filename (basename).
// The XLSX cost-column heuristic is intentionally NOT here because
// exceljs is async -- keep classifyFile() synchronous for testability.
// The async refinement (unknown xlsx -> operations/) is handled in
// runNormalize() after classifyFile() returns 'unknown'.

export type FileCategory =
  | 'cmdb'
  | 'incidents'
  | 'network_flows'
  | 'iac'
  | 'architecture'
  | 'workshops'
  | 'policy_pdf'
  | 'legal_pdf'
  | 'compliance'
  | 'source_code'
  | 'unknown';

export interface ClassifiedFile {
  sourcePath: string;   // absolute path in wsp/intake/
  category: FileCategory;
  targetSubdir: string; // e.g. 'operations/', 'source/', 'architecture/'
  targetName: string;   // basename for wsp/inputs/<targetSubdir>/<targetName>
  confidence: 'high' | 'medium' | 'low';
  requiresLlm: boolean;
  notes: string;
}

interface Rule {
  test: (lower: string) => boolean;
  category: FileCategory;
  targetSubdir: string;
  confidence: 'high' | 'medium' | 'low';
  requiresLlm: boolean;
}

// Rules are evaluated in order -- first match wins. Specific patterns
// must come before catch-alls (e.g. workshop*.docx before *.docx).
const RULES: Rule[] = [
  // SBOM XLSX / CSV -- must come before CMDB (also matches .xlsx)
  {
    test: (f) =>
      (f.includes('sbom') || f.includes('bom') || f.includes('bill-of-materials')) &&
      (f.endsWith('.xlsx') || f.endsWith('.csv') || f.endsWith('.xml') || f.endsWith('.json') || f.endsWith('.cdx')),
    category: 'compliance',
    targetSubdir: 'compliance/',
    confidence: 'high',
    requiresLlm: false,
  },
  // CMDB CSV/XLSX
  {
    test: (f) => (f.startsWith('cmdb') || f.includes('cmdb')) && (f.endsWith('.csv') || f.endsWith('.xlsx')),
    category: 'cmdb',
    targetSubdir: 'operations/',
    confidence: 'high',
    requiresLlm: false,
  },
  // Incidents CSV/XLSX
  {
    test: (f) => (f.startsWith('incident') || f.includes('incident')) && (f.endsWith('.csv') || f.endsWith('.xlsx')),
    category: 'incidents',
    targetSubdir: 'operations/',
    confidence: 'high',
    requiresLlm: false,
  },
  // Network flows CSV
  {
    test: (f) => (f.startsWith('network-flow') || f.startsWith('nftables')) && f.endsWith('.csv'),
    category: 'network_flows',
    targetSubdir: 'operations/',
    confidence: 'high',
    requiresLlm: false,
  },
  // IaC: Terraform / HCL
  {
    test: (f) => f.endsWith('.tf') || f.endsWith('.hcl') || f.includes('terraform'),
    category: 'iac',
    targetSubdir: 'source/',
    confidence: 'high',
    requiresLlm: false,
  },
  // IaC-looking YAML (heuristic -- keyword in name)
  {
    test: (f) =>
      (f.endsWith('.yaml') || f.endsWith('.yml')) &&
      (f.includes('infra') ||
        f.includes('terraform') ||
        f.includes('k8s') ||
        f.includes('helm') ||
        f.includes('deploy') ||
        f.includes('manifest') ||
        f.includes('stack') ||
        f.includes('pipeline') ||
        f.includes('ansible') ||
        f.includes('playbook')),
    category: 'iac',
    targetSubdir: 'source/',
    confidence: 'medium',
    requiresLlm: false,
  },
  // Policy PDF (before legal_pdf and before generic *.pdf)
  {
    test: (f) =>
      f.endsWith('.pdf') &&
      (f.startsWith('policy') || f.includes('policy') || f.includes('procedure')),
    category: 'policy_pdf',
    targetSubdir: 'architecture/guardrails/',
    confidence: 'high',
    requiresLlm: true,
  },
  // Legal PDF
  {
    test: (f) =>
      f.endsWith('.pdf') &&
      (f.startsWith('dpa') ||
        f.includes('agreement') ||
        f.startsWith('soc') ||
        f.includes('legal')),
    category: 'legal_pdf',
    targetSubdir: 'compliance/',
    confidence: 'high',
    requiresLlm: false,
  },
  // Workshop DOCX (before generic *.docx)
  {
    test: (f) =>
      f.endsWith('.docx') &&
      (f.startsWith('workshop') || f.startsWith('meeting')),
    category: 'workshops',
    targetSubdir: 'workshops/',
    confidence: 'high',
    requiresLlm: true,
  },
  // Generic DOCX catch-all
  {
    test: (f) => f.endsWith('.docx'),
    category: 'workshops',
    targetSubdir: 'workshops/',
    confidence: 'medium',
    requiresLlm: true,
  },
  // Architecture PPTX (specific patterns before generic)
  {
    test: (f) =>
      f.endsWith('.pptx') &&
      (f.startsWith('arch') || f.includes('architecture')),
    category: 'architecture',
    targetSubdir: 'architecture/',
    confidence: 'high',
    requiresLlm: true,
  },
  // Generic PPTX catch-all
  {
    test: (f) => f.endsWith('.pptx'),
    category: 'architecture',
    targetSubdir: 'architecture/',
    confidence: 'medium',
    requiresLlm: true,
  },
  // Architecture / workshop MD (specific before catch-all)
  {
    test: (f) =>
      f.endsWith('.md') &&
      (f.startsWith('arch') || f.includes('architecture') || f.includes('design')),
    category: 'architecture',
    targetSubdir: 'architecture/',
    confidence: 'high',
    requiresLlm: false,
  },
  {
    test: (f) =>
      f.endsWith('.md') &&
      (f.startsWith('workshop') || f.startsWith('meeting') || f.startsWith('notes')),
    category: 'workshops',
    targetSubdir: 'workshops/',
    confidence: 'high',
    requiresLlm: false,
  },
  // Generic MD catch-all
  {
    test: (f) => f.endsWith('.md'),
    category: 'architecture',
    targetSubdir: 'architecture/',
    confidence: 'medium',
    requiresLlm: false,
  },
  // Source code
  {
    test: (f) =>
      f.endsWith('.py') ||
      f.endsWith('.ts') ||
      f.endsWith('.js') ||
      f.endsWith('.rs') ||
      f.endsWith('.go'),
    category: 'source_code',
    targetSubdir: 'source/',
    confidence: 'high',
    requiresLlm: false,
  },
];

/**
 * Classify a single file by its filename pattern.
 * The filePath is the absolute source path; filename is the basename.
 * Pure function, synchronous, no IO.
 */
export function classifyFile(filePath: string, filename: string): ClassifiedFile {
  const lower = filename.toLowerCase();

  for (const rule of RULES) {
    if (rule.test(lower)) {
      return {
        sourcePath: filePath,
        category: rule.category,
        targetSubdir: rule.targetSubdir,
        targetName: deriveTargetName(filename, rule.category),
        confidence: rule.confidence,
        requiresLlm: rule.requiresLlm,
        notes: `Matched rule: ${rule.category}`,
      };
    }
  }

  // No rule matched
  return {
    sourcePath: filePath,
    category: 'unknown',
    targetSubdir: 'intake/',
    targetName: filename,
    confidence: 'low',
    requiresLlm: false,
    notes: 'No matching classification rule',
  };
}

/**
 * Derive the target filename. For XLSX -> operations/ the caller will rename
 * to .csv; that override happens in runNormalize, not here.
 */
function deriveTargetName(filename: string, _category: FileCategory): string {
  return filename;
}
