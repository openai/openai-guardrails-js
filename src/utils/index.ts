/**
 * Utility functions for Guardrails.
 *
 * This module provides various utility functions for working with guardrails,
 * including context validation, JSON schema handling, output schema management,
 * response parsing, and vector store operations.
 */

// Context validation utilities
export {
  validateGuardrailContext,
  hasProperty,
  hasRequiredProperties,
  ContextValidationError,
} from './context';

// JSON schema utilities
export {
  ensureStrictJsonSchema,
  resolveRef,
  isDict,
  isList,
  hasMoreThanNKeys,
  validateJson,
} from './schema';

// Output schema utilities
export { OutputSchema, createOutputSchema, canRepresentAsJsonSchemaObject } from './output';

// Response parsing utilities
export {
  Entry,
  parseResponseItems,
  parseResponseItemsAsJson,
  formatEntries,
  formatEntriesAsJson,
  formatEntriesAsText,
  extractTextContent,
  extractJsonContent,
} from './parsing';

// Vector store utilities
export {
  createVectorStore,
  VectorStore,
  VectorStoreConfig,
  Document,
  SearchResult,
} from './vector-store';

// OpenAI vector store utilities
export { createOpenAIVectorStoreFromPath, OpenAIVectorStoreConfig } from './openai-vector-store';

// Safety identifier utilities
export { SAFETY_IDENTIFIER, supportsSafetyIdentifier } from './safety-identifier';
