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

export type {
  IaCToolchain,
  IaCResource,
  IaCResourceGraph,
  IaCSecurityFinding,
  IaCArtefacts,
  IaCProvider,
} from './types.js';

export {
  registerProvider,
  getProvider,
  detectToolchain,
  readIaCState,
  registeredToolchains,
} from './registry.js';

// Terraform / OpenTofu provider
export {
  TerraformOpenTofuProvider,
} from './providers/terraform-opentofu/provider.js';

export type { TfResource, TfState } from './providers/terraform-opentofu/state-parser.js';

export {
  IMAGE_TO_SERVICE_DEP,
  parseTfState,
  collectResourceTypes,
  extractSourceServices,
  findTfstateFiles,
} from './providers/terraform-opentofu/state-parser.js';

export {
  RESOURCE_TYPE_TO_SERVICE_DEP,
  extractPgMajorVersion,
  extractCloudNativeServices,
  mergeServiceMaps,
} from './providers/terraform-opentofu/resource-map.js';

// Pulumi provider
export { PulumiProvider } from './providers/pulumi/provider.js';

export {
  parsePulumiState,
  findPulumiStateFiles,
} from './providers/pulumi/state-parser.js';

export {
  PULUMI_RESOURCE_TYPE_TO_SERVICE_DEP,
  extractPulumiServices,
} from './providers/pulumi/resource-map.js';

export type {
  PulumiStackRef,
  PulumiIngestionResult,
} from './providers/pulumi/cloud-api.js';

export {
  fetchPulumiStackExport,
  ingestPulumiStacks,
} from './providers/pulumi/cloud-api.js';
