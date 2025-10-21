/**
 * This module provides utilities for ensuring JSON schemas conform to a strict standard.
 *
 * Functions:
 *   ensureStrictJsonSchema: Ensures a given JSON schema adheres to the strict standard.
 *   resolveRef: Resolves JSON Schema $ref pointers within a schema object.
 *   isDict: Type guard to check if an object is a JSON-style dictionary.
 *   isList: Type guard to check if an object is a list of items.
 *   hasMoreThanNKeys: Checks if a dictionary has more than a specified number of keys.
 *   validateJson: Validates and parses JSON strings using a schema.
 */

/**
 * A predefined empty JSON schema with strict settings.
 */
const _EMPTY_SCHEMA = {
  additionalProperties: false,
  type: 'object',
  properties: {},
  required: [],
};

/**
 * Type guard to check if an object is a JSON-style dictionary.
 */
export function isDict(obj: unknown): obj is Record<string, unknown> {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Type guard to check if an object is a list of items.
 */
export function isList(obj: unknown): obj is unknown[] {
  return Array.isArray(obj);
}

/**
 * Checks if a dictionary has more than a specified number of keys.
 */
export function hasMoreThanNKeys(obj: Record<string, unknown>, n: number): boolean {
  return Object.keys(obj).length > n;
}

/**
 * Ensures a given JSON schema adheres to the strict standard.
 *
 * This mutates the given JSON schema to ensure it conforms to the `strict`
 * standard that the OpenAI API expects.
 *
 * @param schema - The JSON schema to make strict.
 * @returns The strict JSON schema.
 */
export function ensureStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(schema).length === 0) {
    return _EMPTY_SCHEMA;
  }
  return _ensureStrictJsonSchema(schema, [], schema);
}

/**
 * Recursively ensures a JSON schema is strict.
 *
 * @param jsonSchema - The schema to process.
 * @param path - The current path in the schema.
 * @param root - The root schema object.
 * @returns The strict schema.
 */
function _ensureStrictJsonSchema(
  jsonSchema: unknown,
  path: string[],
  root: Record<string, unknown>
): Record<string, unknown> {
  if (!isDict(jsonSchema)) {
    throw new TypeError(`Expected ${jsonSchema} to be a dictionary; path=${path.join('.')}`);
  }

  const defs = jsonSchema.defs;
  if (isDict(defs)) {
    for (const [defName, defSchema] of Object.entries(defs)) {
      _ensureStrictJsonSchema(defSchema, [...path, 'defs', defName], root);
    }
  }

  const definitions = jsonSchema.definitions;
  if (isDict(definitions)) {
    for (const [definitionName, definitionSchema] of Object.entries(definitions)) {
      _ensureStrictJsonSchema(definitionSchema, [...path, 'definitions', definitionName], root);
    }
  }

  // Ensure additionalProperties is false for object types
  if (jsonSchema.type === 'object') {
    if (!('additionalProperties' in jsonSchema)) {
      jsonSchema.additionalProperties = false;
    }
  }

  // Process properties recursively
  const properties = jsonSchema.properties;
  if (isDict(properties)) {
    for (const [propName, propSchema] of Object.entries(properties)) {
      if (isDict(propSchema)) {
        _ensureStrictJsonSchema(propSchema, [...path, 'properties', propName], root);
      }
    }
  }

  // Process items recursively for array types
  const items = jsonSchema.items;
  if (isDict(items)) {
    _ensureStrictJsonSchema(items, [...path, 'items'], root);
  }

  // Process oneOf, anyOf, allOf recursively
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const value = jsonSchema[key];
    if (isList(value)) {
      for (let i = 0; i < value.length; i++) {
        if (isDict(value[i])) {
          _ensureStrictJsonSchema(value[i], [...path, key, i.toString()], root);
        }
      }
    }
  }

  return jsonSchema;
}

/**
 * Resolves JSON Schema $ref pointers within a schema object.
 *
 * @param schema - The schema object to resolve.
 * @param root - The root schema object for resolving references.
 * @returns The resolved schema.
 */
export function resolveRef(
  schema: Record<string, unknown>,
  root: Record<string, unknown>
): Record<string, unknown> {
  if (!isDict(schema)) {
    return schema as Record<string, unknown>;
  }

  const ref = schema.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    const path = ref.substring(2).split('/');
    let current: unknown = root;

    for (const segment of path) {
      if (current && typeof current === 'object' && segment in current) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        throw new Error(`Invalid $ref path: ${ref}`);
      }
    }

    return resolveRef(current as Record<string, unknown>, root);
  }

  // Recursively resolve refs in nested objects
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$ref') continue;

    if (isDict(value)) {
      resolved[key] = resolveRef(value, root);
    } else if (isList(value)) {
      resolved[key] = value.map((item) => (isDict(item) ? resolveRef(item, root) : item));
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Validates and parses a JSON string using a schema.
 *
 * @param jsonStr - The JSON string to validate and parse.
 * @param schema - The schema to validate against.
 * @param partial - Whether to allow partial JSON parsing.
 * @returns The parsed and validated object.
 */
export function validateJson(
  jsonStr: string,
  schema: Record<string, unknown>
): unknown {
  try {
    const parsed = JSON.parse(jsonStr);

    // Basic schema validation (in a full implementation, you might use a library like Ajv)
    if (schema.type === 'object' && typeof parsed !== 'object') {
      throw new Error(`Expected object, got ${typeof parsed}`);
    }

    if (schema.type === 'array' && !Array.isArray(parsed)) {
      throw new Error(`Expected array, got ${typeof parsed}`);
    }

    if (schema.type === 'string' && typeof parsed !== 'string') {
      throw new Error(`Expected string, got ${typeof parsed}`);
    }

    if (schema.type === 'number' && typeof parsed !== 'number') {
      throw new Error(`Expected number, got ${typeof parsed}`);
    }

    if (schema.type === 'boolean' && typeof parsed !== 'boolean') {
      throw new Error(`Expected boolean, got ${typeof parsed}`);
    }

    // Check required properties for objects
    if (schema.type === 'object' && schema.required && Array.isArray(schema.required)) {
      for (const requiredProp of schema.required) {
        if (typeof requiredProp === 'string' && !(requiredProp in parsed)) {
          throw new Error(`Missing required property: ${requiredProp}`);
        }
      }
    }

    // Check additional properties
    if (schema.type === 'object' && schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}));
      for (const prop of Object.keys(parsed)) {
        if (!allowedProps.has(prop)) {
          throw new Error(`Unexpected property: ${prop}`);
        }
      }
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}
