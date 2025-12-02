/**
 * Unit tests for the types module.
 *
 * This module tests the core type definitions including:
 * - GuardrailResult structure and immutability
 * - CheckFn function signatures
 * - Context interfaces
 * - Type compatibility
 */

import { describe, it, expect } from 'vitest';
import {
  GuardrailResult,
  GuardrailLLMContext,
  aggregateTokenUsageFromInfos,
  extractTokenUsage,
  totalGuardrailTokenUsage,
} from '../../types';
import { OpenAI } from 'openai';

describe('Types Module', () => {
  describe('GuardrailResult', () => {
    it('should create result with required fields', () => {
      const result: GuardrailResult = {
        tripwireTriggered: true,
        info: {
          guardrail_name: 'Example',
        },
      };
      expect(result.tripwireTriggered).toBe(true);
      expect(result.info.guardrail_name).toBe('Example');
    });

    it('should create result with custom info', () => {
      const info = { reason: 'test', severity: 'high' };
      const result: GuardrailResult = {
        tripwireTriggered: false,
        info: {
          guardrail_name: 'Example',
          checked_text: 'test',
          ...info,
        },
      };
      expect(result.tripwireTriggered).toBe(false);
      expect(result.info.reason).toBe('test');
      expect(result.info.severity).toBe('high');
      expect(result.info.checked_text).toBe('test');
    });

    it('should handle minimal info', () => {
      const result: GuardrailResult = {
        tripwireTriggered: true,
        info: {
          guardrail_name: 'Example',
        },
      };
      expect(result.tripwireTriggered).toBe(true);
      expect(result.info.guardrail_name).toBe('Example');
    });
  });

  describe('CheckFn', () => {
    it('should work with sync function', () => {
      const syncCheck = (ctx: Record<string, unknown>, data: string): GuardrailResult => ({
        tripwireTriggered: data === 'trigger',
        info: {
          guardrail_name: 'Sync',
        },
      });

      const result = syncCheck({}, 'trigger');
      expect(result.tripwireTriggered).toBe(true);
    });

    it('should work with async function', async () => {
      const asyncCheck = async (ctx: Record<string, unknown>, data: string): Promise<GuardrailResult> => ({
        tripwireTriggered: data === 'trigger',
        info: {
          guardrail_name: 'Async',
        },
      });

      const result = await asyncCheck({}, 'trigger');
      expect(result.tripwireTriggered).toBe(true);
    });
  });

  describe('GuardrailLLMContext', () => {
    it('should require guardrailLlm property', () => {
      const context: GuardrailLLMContext = {
        guardrailLlm: {} as unknown as OpenAI,
      };

      expect(context.guardrailLlm).toBeDefined();
    });

    it('should work with mock LLM client', () => {
      // Test that the interface can be implemented with any object that has guardrailLlm
      const mockLLM = { someMethod: () => 'test' };

      const context: GuardrailLLMContext = {
        guardrailLlm: mockLLM as unknown as OpenAI,
      };

      expect(context.guardrailLlm).toBeDefined();
      expect((context.guardrailLlm as unknown as { someMethod: () => string }).someMethod()).toBe('test');
    });
  });

  describe('Type compatibility', () => {
    it('should allow flexible context types', () => {
      const check = (
        ctx: { user: string },
        data: string,
        config: { threshold: number }
      ): GuardrailResult => ({
        tripwireTriggered: data.length > config.threshold,
        info: {
          guardrail_name: 'Length',
        },
      });

      const result = check({ user: 'test' }, 'hello', { threshold: 3 });
      expect(result.tripwireTriggered).toBe(true);
    });

    it('should allow flexible input types', () => {
      const check = (ctx: unknown, data: unknown, _config: unknown): GuardrailResult => ({
        tripwireTriggered: false,
        info: {
          guardrail_name: 'FlexibleInput',
          preview: String(data),
        },
      });

      const result = check({}, 'string input', {});
      expect(result.tripwireTriggered).toBe(false);
    });

    it('should allow flexible config types', () => {
      const check = (ctx: unknown, data: unknown, _config: unknown): GuardrailResult => ({
        tripwireTriggered: false,
        info: {
          guardrail_name: 'FlexibleConfig',
          preview: String(data),
        },
      });

      const result = check({}, 'input', { complex: { nested: 'config' } });
      expect(result.tripwireTriggered).toBe(false);
    });
  });
});

describe('token usage helpers', () => {
  it('extractTokenUsage returns counts when usage present', () => {
    const usage = extractTokenUsage({
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    });
  });

  it('aggregateTokenUsageFromInfos sums values', () => {
    const summary = aggregateTokenUsageFromInfos([
      {
        token_usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
        },
      },
      {
        token_usage: {
          prompt_tokens: 25,
          completion_tokens: 5,
          total_tokens: 30,
        },
      },
    ]);

    expect(summary).toEqual({
      prompt_tokens: 75,
      completion_tokens: 15,
      total_tokens: 90,
    });
  });

  it('totalGuardrailTokenUsage handles GuardrailResults objects', () => {
    const guardrailResults = {
      totalTokenUsage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    const totals = totalGuardrailTokenUsage({ guardrail_results: guardrailResults });
    expect(totals).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('totalGuardrailTokenUsage handles camelCase guardrailResults property', () => {
    const result = totalGuardrailTokenUsage({
      guardrailResults: {
        totalTokenUsage: {
          prompt_tokens: 25,
          completion_tokens: 10,
          total_tokens: 35,
        },
      },
    });

    expect(result).toEqual({
      prompt_tokens: 25,
      completion_tokens: 10,
      total_tokens: 35,
    });
  });
});
