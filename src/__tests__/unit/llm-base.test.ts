import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMConfig, LLMOutput, LLMReasoningOutput, createLLMCheckFn } from '../../checks/llm-base';
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

    it('should default include_reasoning to false', () => {
      const config = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      expect(config.include_reasoning).toBe(false);
    });

    it('should accept include_reasoning parameter', () => {
      const configTrue = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.7,
        include_reasoning: true,
      });

      expect(configTrue.include_reasoning).toBe(true);

      const configFalse = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.7,
        include_reasoning: false,
      });

      expect(configFalse.include_reasoning).toBe(false);
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

  describe('LLMReasoningOutput', () => {
    it('should parse valid output with reasoning', () => {
      const output = LLMReasoningOutput.parse({
        flagged: true,
        confidence: 0.9,
        reason: 'Test reason',
      });

      expect(output.flagged).toBe(true);
      expect(output.confidence).toBe(0.9);
      expect(output.reason).toBe('Test reason');
    });

    it('should require reason field', () => {
      expect(() =>
        LLMReasoningOutput.parse({
          flagged: true,
          confidence: 0.9,
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

    it('should not include reasoning by default (include_reasoning=false)', async () => {
      const guardrail = createLLMCheckFn(
        'Test Guardrail Without Reasoning',
        'Test description',
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

      expect(result.info.flagged).toBe(true);
      expect(result.info.confidence).toBe(0.8);
      expect(result.info.reason).toBeUndefined();
    });

    it('should include reason field when include_reasoning is enabled', async () => {
      const guardrail = createLLMCheckFn(
        'Test Guardrail With Reasoning',
        'Test description',
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
                      content: JSON.stringify({
                        flagged: true,
                        confidence: 0.8,
                        reason: 'This is a test reason',
                      }),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 20,
                  completion_tokens: 15,
                  total_tokens: 35,
                },
              }),
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'test text', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
        include_reasoning: true,
      });

      expect(result.info.flagged).toBe(true);
      expect(result.info.confidence).toBe(0.8);
      expect(result.info.reason).toBe('This is a test reason');
    });

    it('should not include reasoning when include_reasoning=false explicitly', async () => {
      const guardrail = createLLMCheckFn(
        'Test Guardrail Explicit False',
        'Test description',
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
                      content: JSON.stringify({
                        flagged: false,
                        confidence: 0.2,
                      }),
                    },
                  },
                ],
                usage: {
                  prompt_tokens: 18,
                  completion_tokens: 8,
                  total_tokens: 26,
                },
              }),
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'test text', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
        include_reasoning: false,
      });

      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.2);
      expect(result.info.reason).toBeUndefined();
    });
  });
});
