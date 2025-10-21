/**
 * Registry for managing GuardrailSpec instances and maintaining a catalog of guardrails.
 *
 * This module provides the in-memory registry that acts as the authoritative
 * catalog for all available guardrail specifications. The registry supports
 * registration, lookup, removal, and metadata inspection for guardrails,
 * enabling extensibility and dynamic discovery across your application.
 */

import { z } from 'zod';
import { CheckFn, TextInput } from './types';
import { GuardrailSpec, GuardrailSpecMetadata } from './spec';

/**
 * Sentinel config schema for guardrails with no configuration options.
 *
 * Used to indicate that a guardrail does not require any config parameters.
 */
const NO_CONFIG = z.object({});

/**
 * Sentinel context schema for guardrails with no context requirements.
 *
 * Used to indicate that a guardrail can run with an empty context.
 */
const NO_CONTEXT_REQUIREMENTS = z.object({});

/**
 * Metadata snapshot for a guardrail specification.
 *
 * This container bundles descriptive and structural details about a guardrail
 * for inspection, discovery, or documentation.
 */
export interface Metadata {
  /** Unique identifier for the guardrail. */
  name: string;
  /** Explanation of what the guardrail checks. */
  description: string;
  /** MIME type (e.g. "text/plain") the guardrail applies to. */
  mediaType: string;
  /** Whether the guardrail has configuration options. */
  hasConfig: boolean;
  /** Whether the guardrail has context requirements. */
  hasContext: boolean;
  /** Optional structured metadata for discovery and documentation. */
  metadata?: GuardrailSpecMetadata;
}

/**
 * Registry for managing guardrail specifications.
 *
 * This class provides a centralized catalog of all available guardrails,
 * supporting registration, lookup, removal, and metadata inspection.
 */
export class GuardrailRegistry {
  private specs = new Map<string, GuardrailSpec>();

  /**
   * Register a new guardrail specification.
   *
   * @param name Unique identifier for the guardrail.
   * @param checkFn Function implementing the guardrail's logic.
   * @param description Human-readable explanation of the guardrail's purpose.
   * @param mediaType MIME type to which the guardrail applies.
   * @param configSchema Optional Zod schema for configuration validation.
   * @param ctxRequirements Optional Zod schema for context validation.
   * @param metadata Optional structured metadata.
   */
  register<TContext = object, TIn = TextInput, TCfg = object>(
    name: string,
    checkFn: CheckFn<TContext, TIn, TCfg>,
    description: string,
    mediaType: string = 'text/plain',
    configSchema?: z.ZodType<TCfg>,
    ctxRequirements?: z.ZodType<TContext>,
    metadata?: GuardrailSpecMetadata
  ): void {
    const config = configSchema || (NO_CONFIG as unknown as z.ZodType<TCfg>);
    const context = ctxRequirements || (NO_CONTEXT_REQUIREMENTS as unknown as z.ZodType<TContext>);

    const spec = new GuardrailSpec(
      name,
      description,
      mediaType,
      config,
      checkFn,
      context,
      metadata
    );

    this.specs.set(name, spec as unknown as GuardrailSpec);
  }

  /**
   * Look up a guardrail specification by name.
   *
   * @param name Unique identifier for the guardrail.
   * @returns The guardrail specification, or undefined if not found.
   */
  get(name: string): GuardrailSpec | undefined {
    return this.specs.get(name);
  }

  /**
   * Remove a guardrail specification from the registry.
   *
   * @param name Unique identifier for the guardrail.
   * @returns True if the guardrail was removed, false if it wasn't found.
   */
  remove(name: string): boolean {
    return this.specs.delete(name);
  }

  /**
   * Get metadata for all registered guardrails.
   *
   * @returns Array of metadata objects for all registered guardrails.
   */
  metadata(): Metadata[] {
    return this.get_all_metadata();
  }

  /**
   * Get all registered guardrail specifications.
   *
   * @returns Array of all registered guardrail specifications.
   */
  all(): GuardrailSpec[] {
    return Array.from(this.specs.values());
  }

  /**
   * Check if a guardrail with the given name is registered.
   *
   * @param name Unique identifier for the guardrail.
   * @returns True if the guardrail is registered, false otherwise.
   */
  has(name: string): boolean {
    return this.specs.has(name);
  }

  /**
   * Get the number of registered guardrails.
   *
   * @returns The number of registered guardrails.
   */
  size(): number {
    return this.specs.size;
  }

  /**
   * Return a list of all registered guardrail specifications.
   *
   * @returns All registered specs, in registration order.
   */
  get_all(): GuardrailSpec[] {
    return Array.from(this.specs.values());
  }

  /**
   * Return summary metadata for all registered guardrail specifications.
   *
   * This provides lightweight, serializable descriptions of all guardrails,
   * suitable for documentation, UI display, or catalog listing.
   *
   * @returns List of metadata entries for each registered spec.
   */
  get_all_metadata(): Metadata[] {
    return Array.from(this.specs.values()).map((spec) => ({
      name: spec.name,
      description: spec.description,
      mediaType: spec.mediaType,
      hasConfig: spec.configSchema !== NO_CONFIG,
      hasContext: spec.ctxRequirements !== NO_CONTEXT_REQUIREMENTS,
      metadata: spec.metadata,
    }));
  }
}

/**
 * Default global registry instance.
 *
 * This is the primary registry used by the library for built-in guardrails
 * and user registrations.
 */
export const defaultSpecRegistry = new GuardrailRegistry();
