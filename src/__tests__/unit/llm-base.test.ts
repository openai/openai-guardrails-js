import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LLMConfig,
  LLMOutput,
  LLMReasoningOutput,
  createLLMCheckFn,
  extractConversationHistory,
  buildAnalysisPayload,
  DEFAULT_MAX_TURNS,
} from '../../checks/llm-base';
import { defaultSpecRegistry } from '../../registry';
import { GuardrailLLMContext, GuardrailLLMContextWithHistory } from '../../types';

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

    it('should default max_turns to DEFAULT_MAX_TURNS', () => {
      const config = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      expect(config.max_turns).toBe(DEFAULT_MAX_TURNS);
    });

    it('should accept custom max_turns parameter', () => {
      const config = LLMConfig.parse({
        model: 'gpt-4',
        confidence_threshold: 0.7,
        max_turns: 5,
      });

      expect(config.max_turns).toBe(5);
    });

    it('should validate max_turns is at least 1', () => {
      expect(() =>
        LLMConfig.parse({
          model: 'gpt-4',
          max_turns: 0,
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

  describe('extractConversationHistory', () => {
    it('should return empty array when context has no getConversationHistory', () => {
      const ctx = { guardrailLlm: {} } as GuardrailLLMContext;
      const result = extractConversationHistory(ctx);
      expect(result).toEqual([]);
    });

    it('should return conversation history when available', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const ctx = {
        guardrailLlm: {},
        conversationHistory: history,
        getConversationHistory: () => history,
      } as unknown as GuardrailLLMContextWithHistory;

      const result = extractConversationHistory(ctx);
      expect(result).toEqual(history);
    });

    it('should return empty array when getConversationHistory throws', () => {
      const ctx = {
        guardrailLlm: {},
        getConversationHistory: () => {
          throw new Error('Test error');
        },
      } as unknown as GuardrailLLMContextWithHistory;

      const result = extractConversationHistory(ctx);
      expect(result).toEqual([]);
    });

    it('should return empty array when getConversationHistory returns non-array', () => {
      const ctx = {
        guardrailLlm: {},
        getConversationHistory: () => 'not an array' as unknown,
      } as unknown as GuardrailLLMContextWithHistory;

      const result = extractConversationHistory(ctx);
      expect(result).toEqual([]);
    });
  });

  describe('buildAnalysisPayload', () => {
    it('should build payload with conversation history and latest input', () => {
      const history = [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
      ];
      const result = buildAnalysisPayload(history, 'Test input', 10);
      const parsed = JSON.parse(result);

      expect(parsed.conversation).toEqual(history);
      expect(parsed.latest_input).toBe('Test input');
    });

    it('should trim whitespace from latest input', () => {
      const history = [{ role: 'user', content: 'Hello' }];
      const result = buildAnalysisPayload(history, '  Trimmed input  ', 10);
      const parsed = JSON.parse(result);

      expect(parsed.latest_input).toBe('Trimmed input');
    });

    it('should limit conversation history to max_turns', () => {
      const history = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `Message ${i + 1}`,
      }));
      const result = buildAnalysisPayload(history, 'Latest', 5);
      const parsed = JSON.parse(result);

      expect(parsed.conversation).toHaveLength(5);
      // Should include the last 5 messages (11-15)
      expect(parsed.conversation[0].content).toBe('Message 11');
      expect(parsed.conversation[4].content).toBe('Message 15');
    });

    it('should handle empty conversation history', () => {
      const result = buildAnalysisPayload([], 'Test input', 10);
      const parsed = JSON.parse(result);

      expect(parsed.conversation).toEqual([]);
      expect(parsed.latest_input).toBe('Test input');
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
        { engine: 'LLM', usesConversationHistory: true }
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

    it('should use conversation history when available in context', async () => {
      const guardrail = createLLMCheckFn(
        'Multi-Turn Guardrail',
        'Test description',
        'Test system prompt'
      );

      const history = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' },
      ];

      const createMock = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                flagged: false,
                confidence: 0.3,
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
        },
      });

      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: createMock,
            },
          },
        },
        conversationHistory: history,
        getConversationHistory: () => history,
      };

      const result = await guardrail(
        mockContext as unknown as GuardrailLLMContextWithHistory,
        'Current input',
        {
          model: 'gpt-4',
          confidence_threshold: 0.7,
        }
      );

      // Verify the LLM was called with multi-turn payload
      expect(createMock).toHaveBeenCalledTimes(1);
      const callArgs = createMock.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).toContain('# Analysis Input');
      expect(userMessage.content).toContain('Previous message');
      expect(userMessage.content).toContain('Current input');

      // Verify result was successful
      expect(result.tripwireTriggered).toBe(false);
    });

    it('should use single-turn mode when no conversation history', async () => {
      const guardrail = createLLMCheckFn(
        'Single-Turn Guardrail',
        'Test description',
        'Test system prompt'
      );

      const createMock = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                flagged: false,
                confidence: 0.1,
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 5,
          total_tokens: 25,
        },
      });

      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: createMock,
            },
          },
        },
      };

      const result = await guardrail(mockContext as unknown as GuardrailLLMContext, 'Test input', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
      });

      // Verify the LLM was called with single-turn format
      expect(createMock).toHaveBeenCalledTimes(1);
      const callArgs = createMock.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).toContain('# Text');
      expect(userMessage.content).toContain('Test input');
      expect(userMessage.content).not.toContain('# Analysis Input');

      // Verify result was successful
      expect(result.tripwireTriggered).toBe(false);
    });

    it('should respect max_turns config to limit conversation history', async () => {
      const guardrail = createLLMCheckFn(
        'Max Turns Guardrail',
        'Test description',
        'Test system prompt'
      );

      const history = Array.from({ length: 10 }, (_, i) => ({
        role: 'user',
        content: `Turn_${i + 1}`,
      }));

      const createMock = vi.fn().mockResolvedValue({
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
          prompt_tokens: 40,
          completion_tokens: 8,
          total_tokens: 48,
        },
      });

      const mockContext = {
        guardrailLlm: {
          chat: {
            completions: {
              create: createMock,
            },
          },
        },
        conversationHistory: history,
        getConversationHistory: () => history,
      };

      await guardrail(mockContext as unknown as GuardrailLLMContextWithHistory, 'Current', {
        model: 'gpt-4',
        confidence_threshold: 0.7,
        max_turns: 3,
      });

      // Verify the LLM was called with limited history
      expect(createMock).toHaveBeenCalledTimes(1);
      const callArgs = createMock.mock.calls[0][0];
      const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      
      // Should only include the last 3 messages (Turn_8, Turn_9, Turn_10)
      expect(userMessage.content).not.toContain('Turn_1"');
      expect(userMessage.content).not.toContain('Turn_7');
      expect(userMessage.content).toContain('Turn_8');
      expect(userMessage.content).toContain('Turn_10');
    });

    it('should register with usesConversationHistory metadata', () => {
      createLLMCheckFn(
        'Metadata Test Guardrail',
        'Test description',
        'Test system prompt'
      );

      expect(defaultSpecRegistry.register).toHaveBeenCalledWith(
        'Metadata Test Guardrail',
        expect.any(Function),
        'Test description',
        'text/plain',
        expect.any(Object),
        expect.any(Object),
        { engine: 'LLM', usesConversationHistory: true }
      );
    });
  });
});
