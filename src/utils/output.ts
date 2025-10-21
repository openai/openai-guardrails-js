/**
 * This module provides utilities for handling and validating JSON schema output.
 *
 * It includes the `OutputSchema` class, which captures, validates, and parses the
 * JSON schema of the output, and helper functions for type checking and string
 * representation of types.
 */

import { ensureStrictJsonSchema, validateJson } from './schema';

/**
 * Wrapper dictionary key for wrapped output types.
 */
const _WRAPPER_DICT_KEY = 'response';

/**
 * An object that captures and validates/parses the JSON schema of the output.
 */
export class OutputSchema {
  /** The type of the output. */
  private outputType: unknown;

  /** Whether the output type is wrapped in a dictionary. */
  private isWrapped: boolean;

  /** The JSON schema of the output. */
  private outputSchema: Record<string, unknown>;

  /** Whether the JSON schema is in strict mode. */
  public strictJsonSchema: boolean;

  /**
   * Initialize an OutputSchema for the given output type.
   *
   * @param outputType - The target TypeScript type of the LLM output.
   * @param strictJsonSchema - Whether to enforce strict JSON schema generation.
   */
  constructor(outputType: unknown, strictJsonSchema: boolean = true) {
    this.outputType = outputType;
    this.strictJsonSchema = strictJsonSchema;

    if (outputType === null || outputType === undefined || outputType === String) {
      this.isWrapped = false;
      this.outputSchema = { type: 'string' };
      return;
    }

    // We should wrap for things that are not plain text, and for things that would definitely
    // not be a JSON Schema object.
    this.isWrapped = !this.isSubclassOfBaseModelOrDict(outputType);

    if (this.isWrapped) {
      const OutputType = {
        [_WRAPPER_DICT_KEY]: outputType,
      };
      this.outputSchema = this.generateJsonSchema(OutputType);
    } else {
      this.outputSchema = this.generateJsonSchema(outputType);
    }

    if (this.strictJsonSchema) {
      this.outputSchema = ensureStrictJsonSchema(this.outputSchema);
    }
  }

  /**
   * Whether the output type is plain text (versus a JSON object).
   */
  isPlainText(): boolean {
    return this.outputType === null || this.outputType === undefined || this.outputType === String;
  }

  /**
   * The JSON schema of the output type.
   */
  jsonSchema(): Record<string, unknown> {
    if (this.isPlainText()) {
      throw new Error('Output type is plain text, so no JSON schema is available');
    }
    return this.outputSchema;
  }

  /**
   * Validate a JSON string against the output type.
   *
   * Returns the validated object, or raises an error if the JSON is invalid.
   *
   * @param jsonStr - The JSON string to validate.
   * @param partial - Whether to allow partial JSON parsing.
   * @returns The validated object.
   */
  validateJson(jsonStr: string): unknown {
    const validated = validateJson(jsonStr, this.outputSchema);

    if (this.isWrapped) {
      if (typeof validated !== 'object' || validated === null) {
        throw new Error('Expected object for wrapped output type');
      }

      const wrapped = validated as Record<string, unknown>;
      if (!(_WRAPPER_DICT_KEY in wrapped)) {
        throw new Error(`Expected key '${_WRAPPER_DICT_KEY}' in wrapped output`);
      }

      return wrapped[_WRAPPER_DICT_KEY];
    }

    return validated;
  }

  /**
   * Generate a JSON schema for a given type.
   *
   * This is a simplified implementation. In a full implementation, you might want to use
   * a library like `ts-json-schema-generator` or similar.
   *
   * @param type - The type to generate a schema for.
   * @returns The JSON schema.
   */
  private generateJsonSchema(type: unknown): Record<string, unknown> {
    // This is a basic implementation - you might want to use a proper schema generator
    if (type === String || type === 'string') {
      return { type: 'string' };
    }

    if (type === Number || type === 'number') {
      return { type: 'number' };
    }

    if (type === Boolean || type === 'boolean') {
      return { type: 'boolean' };
    }

    if (Array.isArray(type)) {
      return {
        type: 'array',
        items: this.generateJsonSchema(type[0] || {}),
      };
    }

    if (typeof type === 'object' && type !== null) {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(type)) {
        properties[key] = this.generateJsonSchema(value);
        // Assume all properties are required for now
        required.push(key);
      }

      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      };
    }

    // Default to object type
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }

  /**
   * Check if a type is a subclass of BaseModel or dict.
   *
   * @param type - The type to check.
   * @returns True if the type is a subclass of BaseModel or dict.
   */
  private isSubclassOfBaseModelOrDict(type: unknown): boolean {
    // In TypeScript, we'll use a simplified check
    // In a full implementation, you might want to check for specific base classes
    return (
      type === Object ||
      type === Array ||
      (typeof type === 'function' && type.prototype && type.prototype.constructor === type)
    );
  }
}

/**
 * Helper function to create an OutputSchema for a given type.
 *
 * @param outputType - The output type.
 * @param strictJsonSchema - Whether to enforce strict JSON schema.
 * @returns An OutputSchema instance.
 */
export function createOutputSchema(
  outputType: unknown,
  strictJsonSchema: boolean = true
): OutputSchema {
  return new OutputSchema(outputType, strictJsonSchema);
}

/**
 * Check if a type can be represented as a JSON Schema object.
 *
 * @param type - The type to check.
 * @returns True if the type can be represented as a JSON Schema object.
 */
export function canRepresentAsJsonSchemaObject(type: unknown): boolean {
  if (type === null || type === undefined || type === String) {
    return false;
  }

  if (type === Number || type === Boolean || Array.isArray(type)) {
    return true;
  }

  if (typeof type === 'object' && type !== null) {
    return true;
  }

  return false;
}
