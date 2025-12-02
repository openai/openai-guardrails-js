/**
 * Guardrails public API surface.
 *
 * This package exposes utilities to define and run guardrails which validate
 * arbitrary data. The submodules provide runtime helpers, exception
 * types and a registry of built-in checks.
 */

// Core types and interfaces
export { GuardrailResult, GuardrailLLMContext, CheckFn, totalGuardrailTokenUsage } from './types';

// Exception types
export {
  GuardrailError,
  GuardrailTripwireTriggered,
  GuardrailConfigurationError,
  GuardrailNotFoundError,
  GuardrailExecutionError,
} from './exceptions';

// Registry and specifications
export { GuardrailRegistry, defaultSpecRegistry, Metadata } from './registry';
export { GuardrailSpec, GuardrailSpecMetadata } from './spec';

// Runtime execution
export {
  ConfiguredGuardrail,
  checkPlainText,
  runGuardrails,
  instantiateGuardrails,
  loadConfigBundle,
  loadConfigBundleFromFile,
  loadPipelineBundles,
  GuardrailConfig,
  GuardrailBundle,
  PipelineConfig,
} from './runtime';

// Client interfaces (Drop-in replacements for OpenAI clients)
export {
  GuardrailsOpenAI,
  GuardrailsAzureOpenAI,
  GuardrailsResponse,
  GuardrailResults,
} from './client';

// Base client functionality
export { GuardrailsBaseClient, OpenAIResponseType } from './base-client';

// Built-in checks
// Importing this module will automatically register all built-in guardrails
// with the defaultSpecRegistry
export * from './checks';

// Utility functions
export * from './utils';

// Evaluation framework
export * from './evals';

// Agents SDK integration
export { GuardrailAgent } from './agents';

// CLI tool
export { main as cli } from './cli';

// Re-export commonly used types
export type { MaybeAwaitableResult, TokenUsage, TokenUsageSummary } from './types';
