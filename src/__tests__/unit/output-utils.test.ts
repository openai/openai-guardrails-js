/**
 * Unit tests for output schema utilities.
 *
 * These evaluate the OutputSchema wrapper, JSON validation behaviour,
 * and helper predicates for representing schema-capable types.
 */

import { describe, it, expect } from 'vitest';
import {
  OutputSchema,
  createOutputSchema,
  canRepresentAsJsonSchemaObject,
} from '../../utils/output';

describe('OutputSchema', () => {
  it('detects plain text outputs', () => {
    const schema = new OutputSchema(String);
    expect(schema.isPlainText()).toBe(true);
    expect(() => schema.jsonSchema()).toThrow('Output type is plain text, so no JSON schema is available');
    expect(schema.validateJson('"hello"')).toBe('hello');
  });

  it('generates schemas for object literals and validates payloads', () => {
    const schema = new OutputSchema({
      name: String,
      count: Number,
    });

    expect(schema.isPlainText()).toBe(false);
    const jsonSchema = schema.jsonSchema();
    expect(jsonSchema).toMatchObject({
      type: 'object',
      required: ['response'],
      properties: {
        response: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['name', 'count'],
          additionalProperties: false,
        },
      },
    });

    const value = schema.validateJson('{"response":{"name":"guardrails","count":2}}');
    expect(value).toEqual({ name: 'guardrails', count: 2 });
    expect(schema.validateJson('{"response":{"name":"missing"}}')).toEqual({ name: 'missing' });
  });

  it('wraps array-like specifications and unwraps validated results', () => {
    const schema = new OutputSchema([String]);
    const jsonSchema = schema.jsonSchema();

    expect(jsonSchema).toMatchObject({
      type: 'object',
      properties: {
        response: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['response'],
    });

    const value = schema.validateJson('{"response":["a","b"]}');
    expect(value).toEqual(['a', 'b']);
    expect(schema.validateJson('{"response":[1]}')).toEqual([1]);
    expect(() => schema.validateJson('{"unexpected":["a"]}')).toThrow(
      'Missing required property: response'
    );
  });

  it('enforces wrapper key for wrapped outputs', () => {
    const schema = new OutputSchema([Number]);
    expect(() => schema.validateJson('{"response_missing":[1]}')).toThrow(
      'Missing required property: response'
    );
  });

  it('honours strictJsonSchema flag', () => {
    const schema = createOutputSchema({ optional: String }, false);
    expect(schema.jsonSchema().required).toContain('response');
    expect(schema.strictJsonSchema).toBe(false);
  });
});

describe('canRepresentAsJsonSchemaObject', () => {
  it('identifies types that can produce JSON schema objects', () => {
    expect(canRepresentAsJsonSchemaObject({})).toBe(true);
    expect(canRepresentAsJsonSchemaObject([String])).toBe(true);
    expect(canRepresentAsJsonSchemaObject(Number)).toBe(true);
    expect(canRepresentAsJsonSchemaObject(null)).toBe(false);
    expect(canRepresentAsJsonSchemaObject(undefined)).toBe(false);
    expect(canRepresentAsJsonSchemaObject(String)).toBe(false); // plain text
  });
});
