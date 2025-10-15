/**
 * Unit tests for schema utility helpers.
 *
 * These tests exercise strict-schema enforcement, $ref resolution,
 * basic JSON validation, and helper type guards used by guardrail output handling.
 */

import { describe, it, expect } from 'vitest';
import {
  ensureStrictJsonSchema,
  resolveRef,
  validateJson,
  isDict,
  isList,
  hasMoreThanNKeys,
} from '../../utils/schema';

describe('schema utilities', () => {
  describe('type guards and helpers', () => {
    it('correctly identifies dictionaries and lists', () => {
      expect(isDict({})).toBe(true);
      expect(isDict([])).toBe(false);
      expect(isList([])).toBe(true);
      expect(isList({})).toBe(false);
    });

    it('checks when object has more than N keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      expect(hasMoreThanNKeys(obj, 2)).toBe(true);
      expect(hasMoreThanNKeys(obj, 3)).toBe(false);
    });
  });

  describe('ensureStrictJsonSchema', () => {
    it('returns a standard empty schema when given an empty object', () => {
      const result = ensureStrictJsonSchema({});
      expect(result).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      });
    });

    it('enforces additionalProperties=false recursively', () => {
      const schema = {
        type: 'object',
        properties: {
          profile: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
          tags: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
              },
            },
          },
        },
      };

      const result = ensureStrictJsonSchema(schema);

      expect(result.additionalProperties).toBe(false);
      const profile = (result.properties as any).profile;
      expect(profile.additionalProperties).toBe(false);
      const tagItems = (result.properties as any).tags.items;
      expect(tagItems.additionalProperties).toBe(false);
    });

  });

  describe('resolveRef', () => {
    const rootSchema = {
      definitions: {
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
          },
          required: ['street'],
        },
      },
      properties: {
        address: {
          $ref: '#/definitions/Address',
        },
      },
    };

    it('resolves local $ref pointers', () => {
      const resolved = resolveRef(rootSchema.properties.address as any, rootSchema);
      expect(resolved).toMatchObject({
        type: 'object',
        properties: {
          street: { type: 'string' },
        },
      });
    });

    it('recursively resolves nested refs within arrays and objects', () => {
      const schema = {
        type: 'object',
        properties: {
          addresses: {
            type: 'array',
            items: {
              properties: {
                home: { $ref: '#/definitions/Address' },
              },
            },
          },
        },
      };

      const resolved = resolveRef(schema, {
        ...rootSchema,
        ...schema,
      });

      const homeSchema = (resolved.properties as any).addresses.items.properties.home;
      expect(homeSchema.properties.street.type).toBe('string');
    });

    it('throws when resolving an invalid ref path', () => {
      expect(() =>
        resolveRef({ $ref: '#/definitions/Missing' } as any, rootSchema)
      ).toThrow('Invalid $ref path');
    });
  });

  describe('validateJson', () => {
    const strictObjectSchema = ensureStrictJsonSchema({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
      },
    });

    it('parses valid JSON payloads', () => {
      const result = validateJson('{"name":"Guardrails"}', strictObjectSchema);
      expect(result).toEqual({ name: 'Guardrails' });
    });

    it('throws when required properties are missing', () => {
      expect(() => validateJson('{}', strictObjectSchema)).toThrow(
        'Missing required property: name'
      );
    });

    it('throws when additional properties are present', () => {
      expect(() => validateJson('{"name":"ok","extra":true}', strictObjectSchema)).toThrow(
        'Unexpected property: extra'
      );
    });

    it('validates array schemas', () => {
      const schema = ensureStrictJsonSchema({
        type: 'array',
      });

      expect(() => validateJson('["a","b"]', schema)).not.toThrow();
      expect(() => validateJson('{"not":"array"}', schema)).toThrow('Expected array');
    });

    it('reports invalid JSON syntax', () => {
      expect(() => validateJson('{invalid}', strictObjectSchema)).toThrow(
        /Invalid JSON:/
      );
    });
  });
});
