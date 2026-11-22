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

// #3956, moved here by #3981 (Design 123 sections 9.5 and 12): the regex mask
// for native-looking identifiers in free text (check details, rationales),
// shared by the publication extractor, the app baseline rules and the MCP LZ
// tools. Defence in depth: the evaluators write counts and kinds only.

/**
 * Replace native-looking identifiers with `[id]`. Covers UUIDs, ARNs, Azure
 * resource paths, typed cloud ids (i-, vol-, sg-, ...), long hex strings, AWS
 * Organizations ids and 12-digit account ids. Pseudonyms (`Node-<10 hex>`,
 * `Ref-<10 hex>`) are short and stay. Use it on LZ text only: it also masks
 * sha256 values and other long hex, which other tools must keep.
 */
export function maskNativeIds(s: string): string {
  return s
    .replace(/arn:[a-z0-9-]+:[^\s,;)]+/gi, '[id]')
    .replace(/\/subscriptions\/[^\s,;)]+/gi, '[id]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b(?:i|vol|sg|vpc|subnet|eni|ami|snap|db|igw|nat|rtb|acl|eip)-[0-9a-f]{8,17}\b/gi, '[id]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[id]')
    // #3956: AWS Organizations ids (SCP, OU, root, organisation) and 12-digit account ids.
    .replace(/\b(?:p-[0-9a-z]{8,128}|ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}|r-[0-9a-z]{4,32}|o-[0-9a-z]{10,32})\b/g, '[id]')
    .replace(/\b\d{12}\b/g, '[id]');
}
