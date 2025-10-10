/**
 * Unit tests for the runtime module.
 *
 * This module tests the core runtime functionality including:
 * - Configuration bundle loading
 * - Guardrail instantiation
 * - Guardrail execution
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GuardrailConfig,
  GuardrailBundle,
  loadConfigBundle,
  instantiateGuardrails,
  runGuardrails,
  checkPlainText,
  loadPipelineBundles,
} from '../../runtime';
import { CheckFn, GuardrailLLMContext } from '../../types';
import { defaultSpecRegistry } from '../../registry';
import { z } from 'zod';
import { OpenAI } from 'openai';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';

// Mock OpenAI module
vi.mock('openai', () => ({
  OpenAI: class MockOpenAI {},
}));

// Mock context
const context: GuardrailLLMContext = {
  guardrailLlm: new OpenAI({ apiKey: 'test-key' }),
};

describe('Runtime Module', () => {
  describe('loadConfigBundle', () => {
    it('should load valid configuration bundle', () => {
      const bundleJson = JSON.stringify({
        version: 1,
        stageName: 'test',
        guardrails: [
          {
            name: 'test_guard',
            config: { threshold: 10 },
          },
        ],
      });

      const bundle = loadConfigBundle(bundleJson);
      expect(bundle.version).toBe(1);
      expect(bundle.stageName).toBe('test');
      expect(bundle.guardrails).toHaveLength(1);
    });

    it('should handle invalid JSON gracefully', () => {
      expect(() => loadConfigBundle('invalid json')).toThrow();
    });

    it('should validate required fields', () => {
      const invalidBundle = JSON.stringify({
        stageName: 'test',
        guardrails: [
          {
            name: 'test_guard',
            // Missing config
          },
        ],
      });

      expect(() => loadConfigBundle(invalidBundle)).toThrow();
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GuardrailConfig', () => {
    it('should create config with required fields', () => {
      const config: GuardrailConfig = {
        name: 'test_guard',
        config: { threshold: 10 },
      };
      expect(config.name).toBe('test_guard');
      expect(config.config.threshold).toBe(10);
    });
  });

  describe('GuardrailBundle', () => {
    it('should create bundle with required fields', () => {
      const bundle: GuardrailBundle = {
        stageName: 'test',
        guardrails: [],
      };

      expect(bundle.stageName).toBe('test');
      expect(bundle.guardrails).toHaveLength(0);
    });

    it('should validate required fields', () => {
      expect(() => loadConfigBundle('{"version": 1}')).toThrow();
    });
  });

  describe('Guardrail Execution', () => {
    const TEST_GUARD = 'runtime_test_guard';
    const configSchema = z.object({
      threshold: z.number(),
      shouldTrip: z.boolean().optional(),
    });

    let guardrailCheck: CheckFn<any, any, any>;

    beforeEach(() => {
      guardrailCheck = vi.fn().mockImplementation((_ctx, data, cfg) => ({
        tripwireTriggered: Boolean(cfg.shouldTrip),
        info: {
          checked_text: data,
          threshold: cfg.threshold,
        },
      }));

      defaultSpecRegistry.register(
        TEST_GUARD,
        guardrailCheck,
        'Runtime test guard',
        'text/plain',
        configSchema,
        z.any(),
        { name: 'Runtime Test Guard' }
      );
    });

    afterEach(() => {
      defaultSpecRegistry.remove(TEST_GUARD);
    });

    const createBundle = (config: Record<string, unknown> = { threshold: 5 }): GuardrailBundle => ({
      guardrails: [
        {
          name: TEST_GUARD,
          config,
        },
      ],
    });

    it('should instantiate guardrails with validated config', async () => {
      const bundle = createBundle({ threshold: 2 });

      const guardrails = await instantiateGuardrails(bundle);

      expect(guardrails).toHaveLength(1);
      expect(guardrails[0].config).toEqual({ threshold: 2 });
      expect(typeof guardrails[0].run).toBe('function');
    });

    it('should run guardrails and return aggregated results', async () => {
      const bundle = createBundle({ threshold: 7 });

      const results = await runGuardrails('payload', bundle, context);

      expect(results).toHaveLength(1);
      expect(results[0].tripwireTriggered).toBe(false);
      expect(results[0].info).toMatchObject({
        checked_text: 'payload',
        threshold: 7,
      });
      expect(guardrailCheck).toHaveBeenCalledWith(context, 'payload', { threshold: 7 });
    });

    it('should surface execution failures without raising when raiseGuardrailErrors=false', async () => {
      guardrailCheck = vi.fn().mockRejectedValue(new Error('boom'));

      defaultSpecRegistry.remove(TEST_GUARD);
      defaultSpecRegistry.register(
        TEST_GUARD,
        guardrailCheck,
        'Runtime test guard',
        'text/plain',
        configSchema,
        z.any(),
        { name: 'Runtime Test Guard' }
      );

      const bundle = createBundle({ threshold: 1 });

      const results = await runGuardrails('payload', bundle, context);

      expect(results).toHaveLength(1);
      expect(results[0].executionFailed).toBe(true);
      expect(results[0].tripwireTriggered).toBe(false);
      expect(results[0].info?.guardrailName).toBe('Runtime Test Guard');
      expect(results[0].info?.checked_text).toBe('payload');
    });

    it('should rethrow the first execution failure when raiseGuardrailErrors=true', async () => {
      guardrailCheck = vi.fn().mockRejectedValue(new Error('explode'));

      defaultSpecRegistry.remove(TEST_GUARD);
      defaultSpecRegistry.register(
        TEST_GUARD,
        guardrailCheck,
        'Runtime test guard',
        'text/plain',
        configSchema,
        z.any(),
        { name: 'Runtime Test Guard' }
      );

      const bundle = createBundle({ threshold: 3 });

      await expect(runGuardrails('payload', bundle, context, true)).rejects.toThrow('explode');
    });

    it('should throw when a guardrail tripwire is triggered via checkPlainText', async () => {
      guardrailCheck = vi.fn().mockResolvedValue({
        tripwireTriggered: true,
        info: { reason: 'bad' },
      });

      defaultSpecRegistry.remove(TEST_GUARD);
      defaultSpecRegistry.register(
        TEST_GUARD,
        guardrailCheck,
        'Runtime test guard',
        'text/plain',
        configSchema,
        z.any(),
        { name: 'Runtime Test Guard' }
      );

      const bundle = createBundle({ threshold: 4, shouldTrip: true });

      await expect(checkPlainText('payload', bundle, context)).rejects.toThrow(
        /Content validation failed: 1 security violation/
      );

      try {
        await checkPlainText('payload', bundle, context);
      } catch (error: any) {
        expect(Array.isArray(error.guardrailResults)).toBe(true);
        expect(error.guardrailResults).toHaveLength(1);
        expect(error.guardrailResults[0].info?.reason).toBe('bad');
      }
    });

    it('should throw if a guardrail name cannot be found in the registry', async () => {
      const bundle: GuardrailBundle = {
        guardrails: [
          {
            name: 'missing_guardrail',
            config: {},
          },
        ],
      };

      await expect(instantiateGuardrails(bundle)).rejects.toThrow(
        "Guardrail 'missing_guardrail' not found in registry"
      );
    });

    it('should surface schema validation errors during guardrail instantiation', async () => {
      const bundle = createBundle({ threshold: 'bad' });

      await expect(instantiateGuardrails(bundle)).rejects.toThrow(
        /Failed to instantiate guardrail 'runtime_test_guard'/
      );
    });
  });

  describe('loadPipelineBundles', () => {
    it('should parse JSON string configs', async () => {
      const config = { input: { guardrails: [] } };
      const result = await loadPipelineBundles(JSON.stringify(config));

      expect(result).toEqual(config);
    });

    it('should load pipeline configs from disk when given a file path', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-tests-'));
      const filePath = path.join(tempDir, 'pipeline.json');
      const config = { output: { guardrails: [] } };

      await fs.writeFile(filePath, JSON.stringify(config), 'utf-8');

      const result = await loadPipelineBundles(filePath);
      expect(result).toEqual(config);

      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('should return config objects unchanged', async () => {
      const config = { pre_flight: { guardrails: [] } };
      const result = await loadPipelineBundles(config);

      expect(result).toBe(config);
    });
  });
});
