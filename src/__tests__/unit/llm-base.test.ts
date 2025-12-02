import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMConfig, LLMOutput, createLLMCheckFn } from '../../checks/llm-base';
import { defaultSpecRegistry } from '../../registry';
import { GuardrailLLMContext } from '../../types';

// Mock the registry
vi.mock('../../registry', () => ({
  defaultSpecRegistry: {
    register: vi.fn(),
  },
}));

describe('LLM Base', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('LLMConfig', () => {
    it('should parse valid config', () => {
      const config = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.8,
      });

      expect(config.model).toBe('gpt-4');
      expect(config.confidence_threshold).toBe(0.8);
    });

    it('should use default confidence threshold', () => {
      const config = LLMConfig.parse({
        model: 'gpt-4',
      });

      expect(config.confidence_threshold).toBe(0.7);
    });

    it('should validate confidence threshold range', () => {
      expect(() =>
        LLMConfig.parse({
          model: 'gpt-4',
          confidence_threshold: 1.5,
        })
      ).toThrow();

      expect(() =>
        LLMConfig.parse({
          model: 'gpt-4',
          confidence_threshold: -0.1,
        })
      ).toThrow();
    });
  });

  describe('LLMOutput', () => {
    it('should parse valid output', () => {
      const output = LLMOutput.parse({
        flagged: true,
        confidence: 0.9,
      });

      expect(output.flagged).toBe(true);
      expect(output.confidence).toBe(0.9);
    });

    it('should validate confidence range', () => {
      expect(() =>
        LLMOutput.parse({
          flagged: true,
          confidence: 1.5,
        })
      ).toThrow();
    });
  });

  describe('createLLMCheckFn', () => {
    it('should create and register a guardrail function', () => {
      const guardrail = createLLMCheckFn(
        'Test Guardrail',
        'Test description',
        'Test system prompt',
        LLMOutput,
        LLMConfig
      );

      expect(guardrail).toBeDefined();
      expect(typeof guardrail).toBe('function');
      expect(defaultSpecRegistry.register).toHaveBeenCalledWith(
        'Test Guardrail',
        expect.any(Function),
        'Test description',
        'text/plain',
        LLMConfig,
        expect.any(Object),
        { engine: 'LLM' }
      );
    });

    it('should create a working guardrail function', async () => {
      const guardrail = createLLMCheckFn(
        'Test Guardrail',
        'Test description',
        'Test system prompt'
      );

      // Mock context
      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        flagged: true,
                        confidence: 0.8,
                      }),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 20,
                  completion_tokens: 10,
                  total_tokens: 30,
                },
              }),
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'test text', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info.guardrail_name).toBe('Test Guardrail');
      expect(result.info.flagged).toBe(true);
      expect(result.info.confidence).toBe(0.8);
      expect(result.info.token_usage).toEqual({
        prompt_tokens: 20,
        completion_tokens: 10,
        total_tokens: 30,
      });
    });

    it('should fail open on schema validation error and not trigger tripwire', async () => {
      const guardrail = createLLMCheckFn(
        'Schema Fail Closed Guardrail',
        'Ensures schema violations are blocked',
        'Test system prompt'
      );

      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [
                  {
                    message: {
                      // confidence is string -> Zod should fail; guardrail should fail-open
                      content: JSON.stringify({ flagged: true, confidence: '1.0' }),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 4,
                  total_tokens: 16,
                },
              }),
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'test text', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.executionFailed).toBe(true);
      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.0);
      expect(result.info.error_message).toBe('LLM response validation failed.');
      // Token usage is now preserved even when schema validation fails
      expect(result.info.token_usage).toEqual({
        prompt_tokens: 12,
        completion_tokens: 4,
        total_tokens: 16,
      });
    });

    it('should fail open on malformed JSON and not trigger tripwire', async () => {
      const guardrail = createLLMCheckFn(
        'Malformed JSON Guardrail',
        'Ensures malformed JSON is blocked',
        'Test system prompt'
      );

      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: vi.fn().mockResolvedValue({
                choices: [
                  {
                    message: {
                      // Non-JSON content -> JSON.parse throws SyntaxError
                      content: 'NOT JSON',
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 8,
                  completion_tokens: 3,
                  total_tokens: 11,
                },
              }),
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'test text', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.executionFailed).toBe(true);
      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.0);
      expect(result.info.error_message).toBe('LLM returned non-JSON or malformed JSON.');
      // Token usage is now preserved even when JSON parsing fails
      expect(result.info.token_usage).toEqual({
        prompt_tokens: 8,
        completion_tokens: 3,
        total_tokens: 11,
      });
    });
  });
});
