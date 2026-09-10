/**
 * Guardrails public API surface.
 *
 * This package exposes utilities to define and run guardrails which validate
 * arbitrary data. The submodules provide runtime helpers, exception
 * types and a registry of built-in checks.
 */

// Agents SDK integration
export { GuardrailAgent } from './agents';
// Base client functionality
export { GuardrailsBaseClient, OpenAIResponseType } from './base-client';
// Built-in checks
// Importing this module will automatically register all built-in guardrails
// with the defaultSpecRegistry
export * from './checks';
// CLI tool
export { main as cli } from './cli';
// Client interfaces (Drop-in replacements for OpenAI clients)
export {
  GuardrailResults,
  GuardrailsAzureOpenAI,
  GuardrailsOpenAI,
  GuardrailsResponse,
} from './client';
// Evaluation framework
export * from './evals';
// Exception types
export {
  GuardrailConfigurationError,
  GuardrailError,
  GuardrailExecutionError,
  GuardrailNotFoundError,
  GuardrailTripwireTriggered,
} from './exceptions';
// Registry and specifications
export { defaultSpecRegistry, GuardrailRegistry, Metadata } from './registry';
// Runtime execution
export {
  ConfiguredGuardrail,
  checkPlainText,
  GuardrailBundle,
  GuardrailConfig,
  instantiateGuardrails,
  loadConfigBundle,
  loadConfigBundleFromFile,
  loadPipelineBundles,
  PipelineConfig,
  runGuardrails,
} from './runtime';
export { GuardrailSpec, GuardrailSpecMetadata } from './spec';
// Re-export commonly used types
export type { MaybeAwaitableResult, TokenUsage, TokenUsageSummary } from './types';
// Core types and interfaces
export { CheckFn, GuardrailLLMContext, GuardrailResult, totalGuardrailTokenUsage } from './types';
// Utility functions
export * from './utils';
