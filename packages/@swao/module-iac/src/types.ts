// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  IaC provider abstraction module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

// ---------------------------------------------------------------------------
// IaC toolchain identifier (design 085 SS4.1)
// ---------------------------------------------------------------------------

export type IaCToolchain =
  | 'terraform'
  | 'opentofu'
  | 'pulumi'
  | 'cdktf'
  | 'aws-cdk'
  | 'bicep'
  | 'crossplane';

// ---------------------------------------------------------------------------
// Normalised IaC resource (single record from any toolchain)
// ---------------------------------------------------------------------------

export interface IaCResource {
  /** Provider-qualified type string, e.g. "aws_s3_bucket", "aws:s3/bucket:Bucket" */
  type: string;
  /** Logical name within the stack / module */
  name: string;
  /** Provider prefix extracted from type, e.g. "aws", "azurerm" */
  provider: string;
  /** Merged input + output attributes from the state file */
  attributes: Record<string, unknown>;
  /** Resource lifecycle mode */
  mode: 'managed' | 'data';
  /** Which IaC tool produced this record */
  sourceToolchain: IaCToolchain;
}

// ---------------------------------------------------------------------------
// Normalised graph emitted by IaCProvider.readState()
// ---------------------------------------------------------------------------

export interface IaCResourceGraph {
  toolchain: IaCToolchain;
  /** Format version from the source state file, e.g. "4", "3", "mixed" */
  formatVersion: string;
  resources: IaCResource[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Security finding from an IaC static scan (design 085 SS12)
// ---------------------------------------------------------------------------

export interface IaCSecurityFinding {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** Fully-qualified resource reference, e.g. "aws_s3_bucket.my-bucket" */
  resource: string;
  message: string;
  remediation?: string;
}

// ---------------------------------------------------------------------------
// Source artefact bundle passed to scanSource()
// ---------------------------------------------------------------------------

export interface IaCArtefacts {
  stateFiles?: string[];
  sourceFiles?: string[];
  planFiles?: string[];
}

// ---------------------------------------------------------------------------
// IaCProvider interface (design 085 SS4.1)
// Implemented by TerraformOpenTofuProvider, PulumiProvider, etc.
// ---------------------------------------------------------------------------

export interface IaCProvider {
  readonly toolchain: IaCToolchain;
  /** Read one or more state files and normalise to IaCResourceGraph */
  readState(filePaths: string[]): Promise<IaCResourceGraph>;
  /** Return true if dirPath looks like a workspace for this toolchain */
  detect(dirPath: string): Promise<boolean>;
  /** Optional: run a static security scan over source artefacts */
  scanSource?(artefacts: IaCArtefacts): Promise<IaCSecurityFinding[]>;
  /** Optional: generate IaC from a resource graph (sprint-111+) */
  generate?(graph: IaCResourceGraph): Promise<string>;
}
