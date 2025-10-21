/**
 * Utility helpers for dealing with guardrail execution contexts.
 *
 * This module exposes utilities to validate runtime objects against guardrail context schemas.
 */

import { GuardrailError } from '../exceptions';

/**
 * Error thrown when context validation fails.
 */
export class ContextValidationError extends GuardrailError {
  constructor(message: string) {
    super(message);
    this.name = 'ContextValidationError';
  }
}

/**
 * Validates a context object against a guardrail's declared context schema.
 *
 * @param guardrail - Guardrail whose context requirements define the schema.
 * @param ctx - Application context instance to validate.
 * @throws {ContextValidationError} If ctx does not satisfy required fields.
 * @throws {TypeError} If ctx's attributes cannot be introspected.
 */
export function validateGuardrailContext<TContext extends object>(
  guardrail: { definition: { name: string; ctxRequirements: unknown } },
  ctx: TContext
): void {
  const model = guardrail.definition.ctxRequirements;

  try {
    // For now, we'll do basic validation
    // In a full implementation, you might want to use a validation library like Zod or Joi
    if (model && typeof model === 'object') {
      // Check if required properties exist on the context
      for (const [key, value] of Object.entries(model)) {
        if (value && typeof value === 'object' && 'required' in value && value.required) {
          if (!(key in ctx)) {
            throw new ContextValidationError(
              `Context for '${guardrail.definition.name}' guardrail expects required property '${key}' which is missing from context`
            );
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof ContextValidationError) {
      throw error;
    }

    // Attempt to get application context schema for better error message
    let appCtxFields: Record<string, unknown> = {};
    try {
      appCtxFields = Object.getOwnPropertyNames(ctx).reduce(
        (acc, prop) => {
          acc[prop] = typeof (ctx as Record<string, unknown>)[prop];
          return acc;
        },
        {} as Record<string, unknown>
      );
    } catch {
      const msg = `Context must support property access, please pass Context as a class instead of '${typeof ctx}'.`;
      throw new ContextValidationError(msg);
    }

    const ctxRequirements = model ? Object.keys(model) : [];
    const msg = `Context for '${guardrail.definition.name}' guardrail expects ${ctxRequirements} which does not match ctx schema '${Object.keys(appCtxFields)}': ${error}`;
    throw new ContextValidationError(msg);
  }
}

/**
 * Type guard to check if an object has a specific property.
 */
export function hasProperty<T extends object, K extends string>(
  obj: T,
  prop: K
): obj is T & Record<K, unknown> {
  return prop in obj;
}

/**
 * Type guard to check if an object has all required properties.
 */
export function hasRequiredProperties<T extends object, K extends string>(
  obj: T,
  requiredProps: K[]
): obj is T & Record<K, unknown> {
  return requiredProps.every((prop) => hasProperty(obj, prop));
}
