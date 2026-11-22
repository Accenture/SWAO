// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  Core library
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// #3956 (Design 123 section 9.5): CSP console links of an evidence reference.
//
// Only URL patterns that the provider's own documentation states are used;
// every pattern below cites the page it comes from. None of the four
// providers documents a console link that takes a resource id or ARN (checked
// 2026-11-06), so every link opens a service page or the console root, never
// one resource: the native id travels next to the link (in the local evidence
// map), and the operator finds the item with it. A link therefore never
// carries a native id or a region-free secret, and SWAO adds no credential:
// the console login decides access. A pattern that cannot be confirmed is not
// guessed; the entry keeps the native reference without a link.

import { z } from 'zod';

export const LZ_CONSOLE_LINK_PRECISION = ['resource', 'service-page', 'console-root'] as const;
export type LzConsoleLinkPrecision = (typeof LZ_CONSOLE_LINK_PRECISION)[number];

export const LzConsoleLinkSchema = z.object({
  url: z.string().url().startsWith('https://'),
  /** `resource` would open the item itself; no documented pattern does today. */
  precision: z.enum(LZ_CONSOLE_LINK_PRECISION),
  /** Where to go from the page, in the console's own words (for example `Security Groups`). */
  navigate: z.string().min(1).optional(),
  /** The official documentation page that states the URL pattern. */
  doc: z.string().url(),
}).strict();
export type LzConsoleLink = z.infer<typeof LzConsoleLinkSchema>;

/** What an evidence entry points at, for the link choice. */
export interface LzConsoleTarget {
  provider: string;
  /** Evidence kind (see LZ_EVIDENCE_KINDS in lz-evidence-refs.ts). */
  kind: string;
  /** Resource type or native kind, for example `ec2.security-group`, `aws:ou`. */
  type?: string;
  region?: string;
}

interface Page { url: string; doc: string; navigate?: string }

// --- AWS (docs.aws.amazon.com) ---------------------------------------------
const AWS_REGIONAL_DOC = 'https://docs.aws.amazon.com/general/latest/gr/mgmt-console.html';
/** "The general syntax of a Regional endpoint is as follows: https://region-code.console.aws.amazon.com" (commercial regions only). */
const AWS_REGION_RE = /^(?:us|eu|ap|ca|sa|me|af|il|mx)-[a-z]+-\d$/;
const AWS_PAGES = {
  ec2: { url: 'https://console.aws.amazon.com/ec2/', doc: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html', navigate: 'Security Groups' },
  kms: { url: 'https://console.aws.amazon.com/kms', doc: 'https://docs.aws.amazon.com/kms/latest/developerguide/finding-keys.html', navigate: 'Customer managed keys' },
  cloudtrail: { url: 'https://console.aws.amazon.com/cloudtrail/', doc: 'https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events-console.html', navigate: 'Trails' },
  config: { url: 'https://console.aws.amazon.com/config/home', doc: 'https://docs.aws.amazon.com/config/latest/developerguide/configuration-recorder-view.html', navigate: 'Settings' },
  backup: { url: 'https://console.aws.amazon.com/backup', doc: 'https://docs.aws.amazon.com/aws-backup/latest/devguide/creating-a-backup-plan.html', navigate: 'Backup plans' },
  iam: { url: 'https://console.aws.amazon.com/iam/', doc: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html', navigate: 'Users' },
  s3: { url: 'https://console.aws.amazon.com/s3/', doc: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html', navigate: 'General purpose buckets' },
  dynamodb: { url: 'https://console.aws.amazon.com/dynamodb/', doc: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/getting-started-step-1.html', navigate: 'Tables' },
  'org-accounts': { url: 'https://console.aws.amazon.com/organizations/v2/home/accounts', doc: 'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_info-operations.html' },
  'org-policies': { url: 'https://console.aws.amazon.com/organizations/v2/home/policies', doc: 'https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_info-operations.html', navigate: 'Service control policies' },
} as const satisfies Record<string, Page>;

// --- Azure (learn.microsoft.com) -------------------------------------------
const AZURE_ROOT: Page = { url: 'https://portal.azure.com/', doc: 'https://learn.microsoft.com/en-us/azure/azure-portal/azure-portal-overview' };
// --- T Cloud Public (formerly Open Telekom Cloud): operator website --------
const OTC_ROOT: Page = { url: 'https://console.otc.t-systems.com/', doc: 'https://www.t-cloud-public.com/en/support/first-steps' };
// --- STACKIT (docs.stackit.cloud) ------------------------------------------
const STACKIT_ROOT: Page = { url: 'https://portal.stackit.cloud/', doc: 'https://docs.stackit.cloud/platform/access-and-identity/user-accounts/how-tos/login-stackit-cloud/' };

/** Every URL a link may carry; `swao lz evidence --open` opens nothing else. */
export const LZ_CONSOLE_LINK_URLS: ReadonlySet<string> = new Set([
  ...Object.values(AWS_PAGES).map((p) => p.url), AZURE_ROOT.url, OTC_ROOT.url, STACKIT_ROOT.url,
]);

/** True for a URL a console link may carry: a listed page, or an AWS regional console host. */
export function isLzConsoleLinkUrl(url: string): boolean {
  if (LZ_CONSOLE_LINK_URLS.has(url)) return true;
  const m = /^https:\/\/([a-z0-9-]+)\.console\.aws\.amazon\.com\/$/.exec(url);
  return m !== null && AWS_REGION_RE.test(m[1] ?? '');
}

function awsServiceOf(t: LzConsoleTarget): keyof typeof AWS_PAGES | undefined {
  const type = (t.type ?? '').toLowerCase();
  const svc = type.split(/[.:]/)[0] ?? '';
  switch (t.kind) {
    case 'ingress_rule': return 'ec2';
    case 'identity': return 'iam';
    case 'trail': return 'cloudtrail';
    case 'backup': return 'backup';
    case 'hierarchy_node': return 'org-accounts';
    case 'guardrail':
      if (type === 'aws-scp') return 'org-policies';
      if (type === 'aws-organization') return 'org-accounts';
      if (type === 'cloudtrail-trail') return 'cloudtrail';
      if (type === 'config-recorder') return 'config';
      return undefined;
    default:
      break;
  }
  if (svc === 'ec2' || svc === 'vpc') return 'ec2';
  if (svc === 'kms' || svc === 'cloudtrail' || svc === 'config' || svc === 'backup' || svc === 'iam' || svc === 's3' || svc === 'dynamodb') return svc;
  if (t.kind === 'encryption' && type === '') return 'kms';
  return undefined;
}

function page(p: Page, precision: LzConsoleLinkPrecision): LzConsoleLink {
  return { url: p.url, precision, ...(p.navigate ? { navigate: p.navigate } : {}), doc: p.doc };
}

/**
 * The console link of one evidence target, or undefined when no documented
 * page fits. Links never contain an id; see the file header.
 */
export function lzConsoleLink(t: LzConsoleTarget): LzConsoleLink | undefined {
  switch (t.provider) {
    case 'aws': {
      const svc = awsServiceOf(t);
      if (svc) return page(AWS_PAGES[svc], 'service-page');
      if (t.region && AWS_REGION_RE.test(t.region)) return { url: `https://${t.region}.console.aws.amazon.com/`, precision: 'console-root', doc: AWS_REGIONAL_DOC };
      return undefined;
    }
    case 'azure': return page(AZURE_ROOT, 'console-root');
    case 'otc': return page(OTC_ROOT, 'console-root');
    case 'stackit': return page(STACKIT_ROOT, 'console-root');
    default: return undefined;
  }
}
