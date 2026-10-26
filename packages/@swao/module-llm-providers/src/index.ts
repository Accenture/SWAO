// ================================================================
//
//                    S  W  A  O
//
//  Sovereign Workload Assessment and Onboarding
//  LLM providers module
//
//  Free and Open-Source Software (FOSS)
//
//  Website       :  https://steady-echo-yp4z.here.now/
//  Technical Docs:  https://accenture.github.io/SWAO/en/
//  Source Code   :  https://github.com/Accenture/SWAO
//
// ================================================================

export type { LlmProvider, LlmUsage, LlmTrace, LlmTool, LlmCompletion, LlmToolChatParams, EmbeddingProvider, EmbeddingResult } from './types.js';
// #3301: per-call usage accessors (prefer the result's own usage over getLastUsage).
export { completeWithUsage, completeVisionWithUsage, completeWithToolsWithUsage } from './completion.js';
export { anthropicCostUsd } from './types.js';
export { OpenLlmProvider, OpenLlmEmbeddingProvider, buildFetchDispatcher } from './open-llm-provider.js';
// #3381 / #3385: connectivity checks with the connector's TLS and proxy rules.
export { connectorPostJson, openAiChatCompletionsUrl, createProxyAwareFetch, type ConnectorFetchResult, type ProxyAwareResponse } from './gateway/connector-fetch.js';
export { FixedLlmProvider } from './fixed.js';
export { OllamaLlmProvider } from './ollama.js';
export { AnthropicLlmProvider, LlmConnectivityError } from './anthropic.js';
export { ConnectivityFailureError, LlmToolsUnsupportedError } from './errors.js';
// #3284: shared provider request helper + provider-level concurrency limiter.
export {
  requestLlmWithRetry,
  withLlmAttemptLimit,
  resolveLlmIdleTimeoutMs,
  classifyLlmHttpStatus,
  LlmHttpStatusError,
  LLM_MAX_ATTEMPTS,
  LLM_CHAT_MAX_ATTEMPTS,
  DEFAULT_LLM_IDLE_TIMEOUT_MS,
} from './llm-request.js';
export type { LlmCallSpec, LlmCallKind, LlmAttemptResult, AttemptWatchdog } from './llm-request.js';
export {
  DEFAULT_LLM_MAX_CONCURRENCY,
  getLlmConcurrencyLimit,
  setLlmConcurrencyLimit,
  llmLimiterKey,
} from './concurrency.js';
export { createLlmProvider } from './factory.js';
export { LlmCacheLayer } from './cache.js';
export { UsageTrackingLlmProvider, mergeUsage } from './usage-tracker.js';
export type { AccumulatedUsage } from './usage-tracker.js';
export type { LlmProviderConfig } from './factory.js';
// Open LLM interface (#0569): connection-string auto-detection + factory.
export {
  parseConnectionString,
  fromConnectionString,
  LlmFactory,
} from './connection-string-parser.js';
export type {
  DetectedProvider,
  ParsedConnection,
  FromConnectionStringOpts,
} from './connection-string-parser.js';
// SWAO LLM-Gateway (Design 090, sprint-113): file-based connector schema + loader.
export {
  ConnectorFileSchema,
  parseConnectorYaml,
  looksLikeSecret,
  CONNECTOR_PROTOCOLS,
  RESERVED_OVERRIDE_KEYS,
} from './gateway/connector-schema.js';
export type {
  ConnectorFile,
  Connector,
  ConnectorModelEntry,
  ConnectorAuth,
  ConnectorTls,
  ConnectorProtocol,
  ParseConnectorResult,
} from './gateway/connector-schema.js';
export { listConnectors, getConnector, seedBundledConnectors, resolveBundledConnectorsDir, updateBundledConnectors, PRIVATE_SEED_MARKER, isPrivateSeedConnector } from './gateway/connector-loader.js';
export type { ConnectorUpdateResult } from './gateway/connector-loader.js';
export { listLocalConnectors } from './gateway/local-connectors.js';
export type { LocalConnectorInfo } from './gateway/local-connectors.js';
export type { LoadedConnector, ListConnectorsResult } from './gateway/connector-loader.js';
export { createProviderFromConnector } from './gateway/resolve.js';
export { buildLlmGatewayProbe, llmGatewayProbeContribution, classifyPingFailure } from './gateway/gateway-probe.js';
export { resolveModelAlias, isAlias } from './gateway/alias-resolver.js';
export { scaffoldWorkspaceGateway, copyConnectorToWorkspace } from './gateway/scaffold.js';
export { discoverModels, mergeDiscoveredModels, writeWorkspaceConnector } from './gateway/discovery.js';
export type { DiscoveredModel, DiscoverResult } from './gateway/discovery.js';
export type { ConnectorProvenance, ResolvedGatewayProvider } from './gateway/resolve.js';
export { getLastGatewayProvenance } from './factory.js';
export type { OpenLlmGatewayOpts } from './open-llm-provider.js';
