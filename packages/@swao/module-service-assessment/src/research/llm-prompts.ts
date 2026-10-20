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
 * Reviewed and approved by the product owner on 2026-10-18 (CLAUDE.md section 6,
 * #3289, Design 110 E-07). Version 1.1 (#3308, Design 110 F-01) adds a small
 * structured `facts` block to three of the four topics; the owner pre-approved
 * that change on 2026-10-18, and its results are assessed in UAT.
 *
 * Prompts for LLM-augmented service research (Design 103 §6.2.4, Design 110
 * D-07). Prompt engineering is reserved for humans (CLAUDE.md §6): these four
 * prompts were drafted by the AI pair-programmer and approved by the product
 * owner; any change needs the owner's review again. Change a prompt only together
 * with LLM_RESEARCH_PROMPT_VERSION, which every research stub records.
 *
 * Inputs are limited to the outbound research contract of research.ts: vendor
 * name, product name, version, and the INFRA-CAT category ID. App IDs, sites,
 * contacts, and other intake data are never placed in a prompt. The provider
 * driver additionally scrubs the prompt for egress (design 032 §2.1).
 */

/** Recorded as `llm.prompt_version` in each stub; bump on any prompt change. */
export const LLM_RESEARCH_PROMPT_VERSION = '1.1-2026-10-18';

export type LlmResearchTopic = 'vendor-profile' | 'certifications' | 'data-residency' | 'breach-history';

export interface LlmResearchPromptInput {
  vendor: string | null;
  product: string | null;
  version: string | null;
  infraCategory: string | null;
}

/** Topic-specific research question. */
export const LLM_RESEARCH_TOPIC_INSTRUCTIONS: Record<LlmResearchTopic, string> = {
  'vendor-profile':
    'Describe the vendor of this product: headquarters country, whether a legal entity exists in the European Union ' +
    '(name the entity and country), ownership (independent, part of a group, private equity, listed), indications of ' +
    'financial stability, the public product roadmap or support lifecycle, the URL of the vendor trust or security page, and ' +
    'how many days the vendor typically takes to release a security patch for a critical vulnerability in this product.',
  certifications:
    'List the security, privacy, and regulatory certifications and attestations that apply to this product or its vendor, ' +
    'for example ISO/IEC 27001, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, BSI C5, TISAX, EU MDR 2017/745 device class ' +
    '(and software as a medical device class), and national medical device registrations (for Germany, the BfArM medical ' +
    'device database). For each, state the scope (product, cloud service, or vendor organisation) and the validity date ' +
    'when published.',
  'data-residency':
    'Describe where this product stores and processes customer data: hosting countries and regions, whether EU-only data ' +
    'residency is available, which sub-processors are used and in which countries, whether a GDPR data processing agreement ' +
    'is offered, and whether the product can be operated on premises or in a customer-controlled environment.',
  'breach-history':
    'Report publicly documented security incidents and data breaches affecting this vendor or product in the last five ' +
    'years, and any enforcement action or fine by a European data protection authority. For each, give the date, a short ' +
    'description, and whether customer data was affected. If nothing is publicly documented, return no findings and say so ' +
    'in the summary.',
};

/**
 * Structured `facts` fields per topic (version 1.1, #3308): one line per field
 * inside the `facts` object of the answer. `breach-history` has none; its
 * findings are the incidents. Parsed by parseLlmFacts (llm-research.ts).
 */
export const LLM_RESEARCH_FACT_FIELDS: Record<LlmResearchTopic, readonly string[]> = {
  'vendor-profile': [
    '"eu_entity": "yes" | "no" | "unknown",  (the vendor has a legal entity in the European Union)',
    '"patch_cadence_days_estimate": number | null,  (typical days from disclosure of a critical vulnerability in this product to the vendor security patch)',
  ],
  certifications: [
    '"mdr_class": "I" | "IIa" | "IIb" | "III" | "not_a_medical_device" | "class_not_published" | "unknown",  (class of this product under ' +
      'EU MDR 2017/745; "class_not_published" when a public source states that it is a medical device but no class is published)',
    '"bfarm_listed": "yes" | "no" | "unknown",  (the product is listed in the German BfArM medical device database)',
  ],
  'data-residency': [
    '"gdpr_dpa_available": "yes" | "no" | "unknown",  (the vendor offers a GDPR data processing agreement for this product)',
  ],
  'breach-history': [],
};

/** Response contract of one topic; parsed by LlmResearchResponseSchema and parseLlmFacts (llm-research.ts). */
export function llmResearchResponseInstructions(topic: LlmResearchTopic): string {
  const fields = LLM_RESEARCH_FACT_FIELDS[topic];
  const facts = fields.length === 0 ? [] : [
    '  "facts": {',
    ...fields.map((f) => `    ${f}`),
    '    "sources": [ "https://..." ]  (URLs of the public sources that state these facts)',
    '  },',
  ];
  const factRules = fields.length === 0 ? [] : [
    '- In "facts", give "yes", "no", a class, or a number only when a public source states it; otherwise use "unknown"',
    '  (or null for the number). Never guess. Put the URLs of the sources for the facts in "facts.sources".',
  ];
  return [
    'Answer with one JSON object and nothing else (no Markdown, no code fences, no text before or after it):',
    '{',
    '  "summary": "two or three sentences answering the question",',
    ...facts,
    '  "findings": [',
    '    {',
    '      "statement": "one factual statement",',
    '      "confidence": "high" | "medium" | "low",',
    '      "sources": [ { "url": "https://...", "title": "page title" } ]',
    '    }',
    '  ]',
    '}',
    'Rules:',
    '- Only state facts you can attribute to a public source. Give the source URL for every finding when you know it.',
    '- Never invent a URL. If you do not know the URL of a source, leave "sources" empty and use confidence "low".',
    '- confidence "high": stated by the vendor or an official register for this product; "medium": stated by a reputable',
    '  third party or for the vendor rather than this product; "low": inferred, dated, or uncertain.',
    ...factRules,
    '- If you have no reliable information, return an empty "findings" array and say so in "summary".',
    '- Write in English.',
  ].join('\n');
}

/** Response contract of a topic without structured facts (`breach-history`); the version 1.0 contract. */
export const LLM_RESEARCH_RESPONSE_INSTRUCTIONS = llmResearchResponseInstructions('breach-history');

function describeProduct(input: LlmResearchPromptInput): string {
  const lines = [
    `Vendor: ${input.vendor ?? 'unknown'}`,
    `Product: ${input.product ?? 'unknown'}`,
    `Version: ${input.version ?? 'not specified'}`,
  ];
  if (input.infraCategory) lines.push(`Category (SWAO infrastructure catalogue): ${input.infraCategory}`);
  return lines.join('\n');
}

/** Full prompt for one topic. */
export function buildLlmResearchPrompt(topic: LlmResearchTopic, input: LlmResearchPromptInput): string {
  return [
    'You are supporting a cloud migration and sovereignty assessment of third-party software. ' +
      'Research the product below using public information.',
    '',
    describeProduct(input),
    '',
    `Question: ${LLM_RESEARCH_TOPIC_INSTRUCTIONS[topic]}`,
    '',
    llmResearchResponseInstructions(topic),
  ].join('\n');
}
