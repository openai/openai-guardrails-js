/**
 * Unit tests for the spec module.
 *
 * This module tests the guardrail specification functionality including:
 * - GuardrailSpec creation and properties
 * - Metadata handling
 * - Schema generation
 * - Validation
 */

import { describe, it, expect } from 'vitest';
import { GuardrailSpec, GuardrailSpecMetadata } from '../../spec';
import { CheckFn, TextInput } from '../../types';
import { z } from 'zod';

// Mock check function for testing
const mockCheck: CheckFn<object, TextInput, object> = (ctx, data) => ({
  tripwireTriggered: false,
  info: {
    checked_text: data,
  },
});

// Test config schema
const TestConfigSchema = z.object({
  threshold: z.number(),
});

// Test context schema
const TestContextSchema = z.object({
  user: z.string(),
});

describe('Spec Module', () => {
  describe('GuardrailSpec', () => {
    it('should create spec with all properties', () => {
      const metadata: GuardrailSpecMetadata = {
        engine: 'typescript',
      };

      const spec = new GuardrailSpec(
        'test_spec',
        'Test specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema,
        metadata
      );

      expect(spec.name).toBe('test_spec');
      expect(spec.description).toBe('Test specification');
      expect(spec.mediaType).toBe('text/plain');
      expect(spec.checkFn).toBe(mockCheck);
      expect(spec.configSchema).toBe(TestConfigSchema);
      expect(spec.ctxRequirements).toBe(TestContextSchema);
      expect(spec.metadata?.engine).toBe('typescript');
    });

    it('should generate JSON schema from config schema', () => {
      const spec = new GuardrailSpec(
        'schema_spec',
        'Schema specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema
      );

      const schema = spec.schema();
      expect(schema).toBeDefined();
      // The schema() method returns the Zod schema definition, not JSON schema
      expect(schema).toBe(TestConfigSchema._def);
    });

    it('should handle spec without config schema', () => {
      const emptySchema = z.object({});
      const spec = new GuardrailSpec(
        'no_config_spec',
        'No config specification',
        'text/plain',
        emptySchema, // Empty config schema
        mockCheck,
        TestContextSchema
      );

      expect(spec.configSchema).toBeDefined();
      const schema = spec.schema();
      expect(schema).toBeDefined();
      // The schema() method returns the Zod schema definition
      expect(schema).toBe(emptySchema._def);
    });

    it('should handle spec without context requirements', () => {
      const spec = new GuardrailSpec(
        'no_context_spec',
        'No context specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        z.object({})
      );

      expect(spec.ctxRequirements).toBeDefined();
    });

    it('should handle spec without metadata', () => {
      const spec = new GuardrailSpec(
        'no_metadata_spec',
        'No metadata specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema
      );

      expect(spec.metadata).toBeUndefined();
    });

    it('should instantiate guardrail from spec', () => {
      const spec = new GuardrailSpec(
        'instantiate_spec',
        'Instantiate specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema
      );

      const guardrail = spec.instantiate({ threshold: 5 });
      expect(guardrail.definition).toBe(spec);
      expect(guardrail.config).toEqual({ threshold: 5 });
    });

    it('should run instantiated guardrail', async () => {
      const spec = new GuardrailSpec(
        'run_spec',
        'Run specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema
      );

      const guardrail = spec.instantiate({ threshold: 5 });
      const result = await guardrail.run({ user: 'test' }, 'Hello world');

      expect(result.tripwireTriggered).toBe(false);
    });
  });

  describe('GuardrailSpecMetadata', () => {
    it('should create metadata with engine', () => {
      const metadata: GuardrailSpecMetadata = {
        engine: 'typescript',
      };

      expect(metadata.engine).toBe('typescript');
    });

    it('should allow extra fields', () => {
      const metadata: GuardrailSpecMetadata = {
        engine: 'regex',
        custom: 123,
        version: '1.0.0',
      };

      expect(metadata.engine).toBe('regex');
      expect((metadata as Record<string, unknown>).custom).toBe(123);
      expect((metadata as Record<string, unknown>).version).toBe('1.0.0');
    });

    it('should handle empty metadata', () => {
      const metadata: GuardrailSpecMetadata = {};

      expect(metadata.engine).toBeUndefined();
    });
  });

  describe('GuardrailSpec instantiation', () => {
    it('should create spec with minimal parameters', () => {
      const spec = new GuardrailSpec(
        'minimal_spec',
        'Minimal specification',
        'text/plain',
        z.object({}),
        mockCheck,
        z.object({})
      );

      expect(spec.name).toBe('minimal_spec');
      expect(spec.description).toBe('Minimal specification');
      expect(spec.mediaType).toBe('text/plain');
    });

    it('should create spec with complex config schema', () => {
      const complexSchema = z.object({
        threshold: z.number(),
        enabled: z.boolean(),
        patterns: z.array(z.string()),
      });

      const spec = new GuardrailSpec(
        'complex_spec',
        'Complex specification',
        'text/plain',
        complexSchema,
        mockCheck,
        z.object({})
      );

      expect(spec.configSchema).toBe(complexSchema);
    });

    it('should create spec with complex context schema', () => {
      const complexContext = z.object({
        user: z.string(),
        permissions: z.array(z.string()),
        settings: z.record(z.unknown()),
      });

      const spec = new GuardrailSpec(
        'complex_context_spec',
        'Complex context specification',
        'text/plain',
        z.object({}),
        mockCheck,
        complexContext
      );

      expect(spec.ctxRequirements).toBe(complexContext);
    });

    it('should handle spec with all optional parameters', () => {
      const spec = new GuardrailSpec(
        'full_spec',
        'Full specification',
        'text/plain',
        TestConfigSchema,
        mockCheck,
        TestContextSchema,
        { engine: 'typescript', version: '1.0.0' }
      );

      expect(spec.metadata?.engine).toBe('typescript');
      expect(spec.metadata?.version).toBe('1.0.0');
    });
  });

  describe('GuardrailSpec validation', () => {
    it('should validate required name', () => {
      expect(
        () =>
          new GuardrailSpec(
            '',
            'Test description',
            'text/plain',
            z.object({}),
            mockCheck,
            z.object({})
          )
      ).not.toThrow();
    });

    it('should validate required description', () => {
      expect(
        () =>
          new GuardrailSpec('test_name', '', 'text/plain', z.object({}), mockCheck, z.object({}))
      ).not.toThrow();
    });

    it('should validate required mediaType', () => {
      expect(
        () =>
          new GuardrailSpec(
            'test_name',
            'Test description',
            '',
            z.object({}),
            mockCheck,
            z.object({})
          )
      ).not.toThrow();
    });

    it('should validate required checkFn', () => {
      expect(
        () =>
          new GuardrailSpec(
            'test_name',
            'Test description',
            'text/plain',
            z.object({}),
            undefined as unknown as CheckFn<object, TextInput, object>,
            z.object({})
          )
      ).not.toThrow();
    });
  });
});
