/**
 * Runtime execution helpers for guardrails.
 *
 * This module provides the bridge between configuration and runtime execution for
 * guardrail validation.
 */

import { GuardrailSpec } from './spec';
import { GuardrailResult, TContext, TIn, TextInput } from './types';
import { defaultSpecRegistry } from './registry';

/**
 * Configuration for a single guardrail instance.
 */
export interface GuardrailConfig {
  /** The registry name used to look up the guardrail spec. */
  name: string;
  /** Configuration object for this guardrail instance. */
  config: Record<string, unknown>;
}

/**
 * A guardrail bundle containing multiple guardrails.
 */
export interface GuardrailBundle {
  /** Version of the bundle format. */
  version?: number;
  /** Name of the stage this bundle applies to. */
  stageName?: string;
  /** Array of guardrail configurations. */
  guardrails: GuardrailConfig[];
}

/**
 * Pipeline configuration structure.
 */
export interface PipelineConfig {
  version?: number;
  pre_flight?: GuardrailBundle;
  input?: GuardrailBundle;
  output?: GuardrailBundle;
}

/**
 * A configured, executable guardrail.
 *
 * This class binds a `GuardrailSpec` definition to a validated configuration
 * object. The resulting instance is used to run guardrail logic in production
 * pipelines. It supports both sync and async check functions.
 */
export class ConfiguredGuardrail<TContext = object, TIn = TextInput, TCfg = object> {
  constructor(
    public readonly definition: GuardrailSpec<TContext, TIn, TCfg>,
    public readonly config: TCfg
  ) {}

  /**
   * Ensure a guardrail function is executed asynchronously.
   *
   * If the function is sync, runs it in a Promise.resolve for compatibility with async flows.
   * If already async, simply awaits it. Used internally to normalize execution style.
   *
   * @param fn Guardrail check function (sync or async).
   * @param args Arguments for the check function.
   * @returns Promise resolving to the result of the check function.
   */
  private async ensureAsync<T extends unknown[]>(
    fn: (...args: T) => GuardrailResult | Promise<GuardrailResult>,
    ...args: T
  ): Promise<GuardrailResult> {
    const result = fn(...args);
    if (result instanceof Promise) {
      return await result;
    }
    return result;
  }

  /**
   * Run the guardrail's check function with the provided context and data.
   *
   * Main entry point for executing guardrails. Supports both sync and async
   * functions, ensuring results are always awaited.
   *
   * @param ctx Runtime context for the guardrail.
   * @param data Input value to be checked.
   * @returns Promise resolving to the outcome of the guardrail logic.
   */
  async run(ctx: TContext, data: TIn): Promise<GuardrailResult> {
    return await this.ensureAsync(this.definition.checkFn, ctx, data, this.config);
  }
}

/**
 * Run a single guardrail bundle on plain text input.
 *
 * This is a high-level convenience function that loads a bundle configuration
 * and runs all guardrails in parallel, throwing an exception if any tripwire
 * is triggered.
 *
 * @param text Input text to validate.
 * @param bundle Guardrail bundle configuration.
 * @param context Optional context object for the guardrails.
 * @throws {Error} If any guardrail tripwire is triggered.
 */
export async function checkPlainText(
  text: string,
  bundle: GuardrailBundle,
  context?: TContext
): Promise<void> {
  const results = await runGuardrails(text, bundle, context);

  // Check if any tripwires were triggered
  const triggeredResults = results.filter((r) => r.tripwireTriggered);
  if (triggeredResults.length > 0) {
    const error = new Error(
      `Content validation failed: ${triggeredResults.length} security violation(s) detected`
    );
    Object.defineProperty(error, 'guardrailResults', {
      value: triggeredResults,
      writable: false,
      enumerable: true,
    });
    throw error;
  }
}

/**
 * Run multiple guardrails in parallel and return all results.
 *
 * This function orchestrates the execution of multiple guardrails,
 * running them concurrently for better performance.
 *
 * @param data Input data to validate.
 * @param bundle Guardrail bundle configuration.
 * @param context Optional context object for the guardrails.
 * @param raiseGuardrailErrors If true, raise exceptions when guardrails fail to execute.
 * @returns Array of guardrail results.
 */
export async function runGuardrails(
  data: TIn,
  bundle: GuardrailBundle,
  context?: TContext,
  raiseGuardrailErrors: boolean = false
): Promise<GuardrailResult[]> {
  const guardrails = await instantiateGuardrails(bundle);

  // Run all guardrails in parallel
  const promises = guardrails.map(async (guardrail) => {
    try {
      return await guardrail.run(context || ({} as TContext), data);
    } catch (error) {
      return {
        tripwireTriggered: false, // Don't trigger tripwire on execution errors
        executionFailed: true,
        originalException: error instanceof Error ? error : new Error(String(error)),
        info: {
          checked_text: data, // Return original data on error
          error: error instanceof Error ? error.message : String(error),
          guardrailName: guardrail.definition.metadata?.name || 'Unknown',
        },
      };
    }
  });

  const results = (await Promise.all(promises)) as GuardrailResult[];

  // Check for guardrail execution failures and re-raise if configured
  if (raiseGuardrailErrors) {
    const executionFailures = results.filter((r) => r.executionFailed);

    if (executionFailures.length > 0) {
      // Re-raise the first execution failure
      console.debug('Re-raising guardrail execution error due to raiseGuardrailErrors=true');
      throw executionFailures[0].originalException;
    }
  }

  return results;
}

/**
 * Instantiate guardrails from a bundle configuration.
 *
 * Creates configured guardrail instances from a bundle specification,
 * validating configurations against their schemas.
 *
 * @param bundle Guardrail bundle configuration.
 * @returns Array of configured guardrail instances.
 */
export async function instantiateGuardrails(
  bundle: GuardrailBundle
): Promise<ConfiguredGuardrail[]> {
  const guardrails: ConfiguredGuardrail[] = [];

  for (const guardrailConfig of bundle.guardrails) {
    const spec = defaultSpecRegistry.get(guardrailConfig.name);
    if (!spec) {
      throw new Error(`Guardrail '${guardrailConfig.name}' not found in registry`);
    }

    try {
      // Validate configuration against schema if available
      let validatedConfig: Record<string, unknown> = guardrailConfig.config;
      if (spec.configSchema) {
        validatedConfig = spec.configSchema.parse(guardrailConfig.config) as Record<string, unknown>;
      }

      const guardrail = spec.instantiate(validatedConfig);
      guardrails.push(guardrail);
    } catch (error) {
      throw new Error(
        `Failed to instantiate guardrail '${guardrailConfig.name}': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return guardrails;
}

/**
 * Load a guardrail bundle configuration from a JSON string.
 *
 * @param jsonString JSON string containing bundle configuration.
 * @returns Parsed guardrail bundle.
 */
export function loadConfigBundle(jsonString: string): GuardrailBundle {
  try {
    const parsed = JSON.parse(jsonString);

    // Handle nested structure (input.guardrails) or direct structure (guardrails)
    let guardrailsArray: unknown[] | undefined;

    if (parsed.guardrails && Array.isArray(parsed.guardrails)) {
      // Direct structure
      guardrailsArray = parsed.guardrails;
    } else if (parsed.input && parsed.input.guardrails && Array.isArray(parsed.input.guardrails)) {
      // Nested structure
      guardrailsArray = parsed.input.guardrails;
    } else {
      throw new Error(
        'Invalid bundle format: missing or invalid guardrails array (expected either "guardrails" or "input.guardrails")'
      );
    }

    // Validate each guardrail config
    for (const guardrail of guardrailsArray!) {
      const guardrailObj = guardrail as Record<string, unknown>;
      if (!guardrailObj.name || typeof guardrailObj.name !== 'string') {
        throw new Error('Invalid guardrail config: missing or invalid name');
      }
      if (!guardrailObj.config || typeof guardrailObj.config !== 'object') {
        throw new Error('Invalid guardrail config: missing or invalid config object');
      }
    }

    // Return in the expected format
    return {
      version: parsed.version,
      stageName: parsed.stageName,
      guardrails: guardrailsArray!,
    } as GuardrailBundle;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load a guardrail bundle configuration from a file.
 *
 * Note: This function requires Node.js fs module and will only work in Node.js environments.
 *
 * @param filePath Path to the JSON configuration file.
 * @returns Parsed guardrail bundle.
 */
export async function loadConfigBundleFromFile(filePath: string): Promise<GuardrailBundle> {
  // Dynamic import to avoid bundling issues
  const fs = await import('fs/promises');
  const content = await fs.readFile(filePath, 'utf-8');
  return loadConfigBundle(content);
}

/**
 * Load pipeline configuration from string or object.
 *
 * @param config Pipeline configuration as string or object
 * @returns Parsed pipeline configuration
 */
export async function loadPipelineBundles(
  config: string | PipelineConfig
): Promise<PipelineConfig> {
  if (typeof config === 'string') {
    // Check if it's a file path (contains .json extension or path separators)
    if (config.includes('.json') || config.includes('/') || config.includes('\\')) {
      // Dynamic import to avoid bundling issues
      const fs = await import('fs/promises');
      const content = await fs.readFile(config, 'utf-8');
      return JSON.parse(content) as PipelineConfig;
    } else {
      // It's a JSON string
      return JSON.parse(config) as PipelineConfig;
    }
  }
  return config;
}
