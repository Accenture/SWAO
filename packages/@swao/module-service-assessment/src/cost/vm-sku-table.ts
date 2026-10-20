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
 * VM size table for the lift-and-shift cost estimate (Design 103 §4.3, #3109).
 * Sizes only: vCPU and memory per Azure and AWS size.
 *
 * #3288 (Design 110 D-23): prices are not embedded any more. They come from
 * the VM price table `prices/vm-prices.json` next to the LZ catalogues
 * (see price-table.ts): the workspace copy written by
 * `swao lz catalogue update`, else the bundled table regenerated from the
 * Azure Retail Prices API and the AWS Price List API, with a Linux and a
 * Windows price per size. The sizes here and VM_PRICE_TARGETS in @swao/core
 * (what the fetchers request) are kept equal by cost.test.ts.
 */

export interface VmSku {
  provider: 'azure' | 'aws';
  sku: string;
  vcpu: number;
  memory_gb: number;
}

/** Regions the bundled price table covers, and the monthly hours of the estimate. */
export const PRICE_BASIS = {
  azure_region: 'germanywestcentral',
  aws_region: 'eu-central-1',
  hours_per_month: 730,
} as const;

/** ECB euro reference rate (units of the currency per 1 EUR). */
export const ECB_REFERENCE = { date: '2026-10-09', usd_per_eur: 1.1206 } as const;

export const VM_SKUS: readonly VmSku[] = [
  { provider: 'azure', sku: 'B1s', vcpu: 1, memory_gb: 1 },
  { provider: 'azure', sku: 'B1ms', vcpu: 1, memory_gb: 2 },
  { provider: 'azure', sku: 'B2s', vcpu: 2, memory_gb: 4 },
  { provider: 'azure', sku: 'B2ms', vcpu: 2, memory_gb: 8 },
  { provider: 'azure', sku: 'B4ms', vcpu: 4, memory_gb: 16 },
  { provider: 'azure', sku: 'D2s_v3', vcpu: 2, memory_gb: 8 },
  { provider: 'azure', sku: 'D4s_v3', vcpu: 4, memory_gb: 16 },
  { provider: 'azure', sku: 'D8s_v3', vcpu: 8, memory_gb: 32 },
  { provider: 'azure', sku: 'D16s_v3', vcpu: 16, memory_gb: 64 },
  { provider: 'azure', sku: 'D32s_v3', vcpu: 32, memory_gb: 128 },
  { provider: 'azure', sku: 'D64s_v3', vcpu: 64, memory_gb: 256 },
  { provider: 'azure', sku: 'E4s_v3', vcpu: 4, memory_gb: 32 },
  { provider: 'azure', sku: 'E8s_v3', vcpu: 8, memory_gb: 64 },
  { provider: 'azure', sku: 'E16s_v3', vcpu: 16, memory_gb: 128 },
  { provider: 'azure', sku: 'E32s_v3', vcpu: 32, memory_gb: 256 },
  { provider: 'azure', sku: 'E64s_v3', vcpu: 64, memory_gb: 432 },
  { provider: 'aws', sku: 't3.micro', vcpu: 2, memory_gb: 1 },
  { provider: 'aws', sku: 't3.small', vcpu: 2, memory_gb: 2 },
  { provider: 'aws', sku: 't3.medium', vcpu: 2, memory_gb: 4 },
  { provider: 'aws', sku: 't3.large', vcpu: 2, memory_gb: 8 },
  { provider: 'aws', sku: 't3.xlarge', vcpu: 4, memory_gb: 16 },
  { provider: 'aws', sku: 't3.2xlarge', vcpu: 8, memory_gb: 32 },
  { provider: 'aws', sku: 'm5.large', vcpu: 2, memory_gb: 8 },
  { provider: 'aws', sku: 'm5.xlarge', vcpu: 4, memory_gb: 16 },
  { provider: 'aws', sku: 'm5.2xlarge', vcpu: 8, memory_gb: 32 },
  { provider: 'aws', sku: 'm5.4xlarge', vcpu: 16, memory_gb: 64 },
  { provider: 'aws', sku: 'm5.8xlarge', vcpu: 32, memory_gb: 128 },
  { provider: 'aws', sku: 'm5.16xlarge', vcpu: 64, memory_gb: 256 },
  { provider: 'aws', sku: 'r5.large', vcpu: 2, memory_gb: 16 },
  { provider: 'aws', sku: 'r5.xlarge', vcpu: 4, memory_gb: 32 },
  { provider: 'aws', sku: 'r5.2xlarge', vcpu: 8, memory_gb: 64 },
  { provider: 'aws', sku: 'r5.4xlarge', vcpu: 16, memory_gb: 128 },
  { provider: 'aws', sku: 'r5.8xlarge', vcpu: 32, memory_gb: 256 },
  { provider: 'aws', sku: 'r5.16xlarge', vcpu: 64, memory_gb: 512 },
];
