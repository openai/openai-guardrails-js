/**
 * Unit tests for the prompt injection detection guardrail.
 */

import type { OpenAI } from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PromptInjectionDetectionConfig,
  promptInjectionDetectionCheck,
} from '../../checks/prompt_injection_detection';
import type { GuardrailLLMContextWithHistory } from '../../types';
import { normalizeConversation } from '../../utils/conversation';

// Mock OpenAI client
const mockOpenAI = {
  chat: {
    completions: {
      create: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                flagged: false,
                confidence: 0.2,
                observation: "The LLM action is aligned with the user's goal",
                evidence: null,
              }),
            },
          },
        ],
      }),
    },
  },
};

describe('Prompt Injection Detection Check', () => {
  let mockContext: GuardrailLLMContextWithHistory;
  let config: PromptInjectionDetectionConfig;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    config = {
      model: 'gpt-4.1-mini',
      confidence_threshold: 0.7,
      include_reasoning: true, // Enable reasoning for tests to verify observation and evidence fields
    };

    mockContext = {
      guardrailLlm: mockOpenAI as unknown as OpenAI,
      getConversationHistory: () => [
        { role: 'user', content: 'What is the weather in Tokyo?' },
        { role: 'assistant', content: 'I will check the weather for you.' },
        { type: 'function_call', name: 'get_weather', arguments: '{"location": "Tokyo"}' },
        {
          type: 'function_call_output',
          call_id: 'call_123',
          output: '{"temperature": 22, "condition": "sunny"}',
        },
      ],
    };
  });

  it('should return skip result when no conversation history', async () => {
    const contextWithoutHistory = {
      ...mockContext,
      getConversationHistory: () => [],
    };

    const result = await promptInjectionDetectionCheck(contextWithoutHistory, 'test data', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.observation).toBe('No actionable tool messages to evaluate');
    expect(result.info.guardrail_name).toBe('Prompt Injection Detection');
    expect(result.info.evidence).toBeNull();
  });

  it('should return skip result when only user messages', async () => {
    const contextWithOnlyUserMessages = {
      ...mockContext,
      getConversationHistory: () => [{ role: 'user', content: 'Hello there!' }],
    };

    const result = await promptInjectionDetectionCheck(
      contextWithOnlyUserMessages,
      'test data',
      config
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.observation).toBe('No actionable tool messages to evaluate');
  });

  it('should return skip result when no LLM actions', async () => {
    const contextWithNoLLMActions = {
      ...mockContext,
      getConversationHistory: () => [{ role: 'user', content: 'Hello there!' }],
    };

    const result = await promptInjectionDetectionCheck(
      contextWithNoLLMActions,
      'test data',
      config
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.observation).toBe('No actionable tool messages to evaluate');
  });

  it('should extract user intent correctly', async () => {
    const result = await promptInjectionDetectionCheck(mockContext, 'test data', config);

    expect(result.info.user_goal).toContain('What is the weather in Tokyo?');
    expect(result.info.action).toBeDefined();
    expect(result.info.guardrail_name).toBe('Prompt Injection Detection');
  });

  it('should handle errors gracefully', async () => {
    const contextWithError = {
      ...mockContext,
      getConversationHistory: () => {
        throw new Error('Test error');
      },
    };

    const result = await promptInjectionDetectionCheck(contextWithError, 'test data', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.observation).toBe('No actionable tool messages to evaluate');
  });

  it('should not flag benign weather check', async () => {
    const result = await promptInjectionDetectionCheck(mockContext, 'test data', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.confidence).toBeLessThan(config.confidence_threshold);
    expect(result.info.guardrail_name).toBe('Prompt Injection Detection');
    expect(result.info.evidence).toBeNull();
    expect(result.info.token_usage).toBeDefined();
  });

  it('should handle context with previous messages', async () => {
    const contextWithHistory = {
      ...mockContext,
      getConversationHistory: () => [
        { role: 'user', content: 'Can you help me?' },
        { role: 'assistant', content: 'Of course!' },
        { role: 'user', content: 'What is the weather in Tokyo?' },
        { role: 'assistant', content: 'I will check the weather for you.' },
        { type: 'function_call', name: 'get_weather', arguments: '{"location": "Tokyo"}' },
      ],
    };

    const result = await promptInjectionDetectionCheck(contextWithHistory, 'test data', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.user_goal).toContain('What is the weather in Tokyo?');
    expect(result.info.user_goal).toContain('Previous context');
  });

  it('should process tool outputs correctly', async () => {
    const contextWithToolOutput = {
      ...mockContext,
      getConversationHistory: () => [
        { role: 'user', content: 'Check the weather in Paris' },
        { type: 'function_call', name: 'get_weather', arguments: '{"location": "Paris"}' },
        { type: 'function_call_output', call_id: 'call_456', output: '{"temperature": 18}' },
      ],
    };

    const result = await promptInjectionDetectionCheck(contextWithToolOutput, 'test data', config);

    expect(result.info.action).toBeDefined();
    expect(result.info.action.length).toBeGreaterThan(0);
  });

  it('should propagate evidence when LLM flags injection', async () => {
    const flaggedOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    flagged: true,
                    confidence: 0.9,
                    observation: 'Detected malicious function call unrelated to user intent',
                    evidence: 'function call: delete_files with arguments {}',
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    const flaggedContext = {
      ...mockContext,
      guardrailLlm: flaggedOpenAI as unknown as OpenAI,
    };

    const result = await promptInjectionDetectionCheck(flaggedContext, 'test data', config);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info.evidence).toBe('function call: delete_files with arguments {}');
  });

  it('should handle empty tool output', async () => {
    const contextWithEmptyOutput = {
      ...mockContext,
      getConversationHistory: () => [
        { role: 'user', content: 'Test query' },
        { type: 'function_call', name: 'test_function', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_789', output: '' },
      ],
    };

    const result = await promptInjectionDetectionCheck(contextWithEmptyOutput, 'test data', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.action).toBeDefined();
  });

  it('should include observation and evidence when include_reasoning=true', async () => {
    const maliciousOpenAI = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    flagged: true,
                    confidence: 0.95,
                    observation: 'Attempting to call credential theft function',
                    evidence: 'function call: steal_credentials',
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 200,
              completion_tokens: 80,
              total_tokens: 280,
            },
          }),
        },
      },
    };

    const contextWithInjection = {
      guardrailLlm: maliciousOpenAI as unknown as OpenAI,
      getConversationHistory: () => [
        { role: 'user', content: 'Get my password' },
        { type: 'function_call', name: 'steal_credentials', arguments: '{}', call_id: 'c1' },
      ],
    };

    const configWithReasoning: PromptInjectionDetectionConfig = {
      model: 'gpt-4.1-mini',
      confidence_threshold: 0.7,
      include_reasoning: true,
    };

    const result = await promptInjectionDetectionCheck(
      contextWithInjection,
      'test data',
      configWithReasoning
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info.flagged).toBe(true);
    expect(result.info.confidence).toBe(0.95);

    // Verify reasoning fields are present
    expect(result.info.observation).toBe('Attempting to call credential theft function');
    expect(result.info.evidence).toBe('function call: steal_credentials');
  });

  it('should exclude observation and evidence when include_reasoning=false', async () => {
    const benignOpenAI = {
      chat: {
        completions: {
          create: async () => ({
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
              prompt_tokens: 180,
              completion_tokens: 40,
              total_tokens: 220,
            },
          }),
        },
      },
    };

    const contextWithBenignCall = {
      guardrailLlm: benignOpenAI as unknown as OpenAI,
      getConversationHistory: () => [
        { role: 'user', content: 'Get weather' },
        {
          type: 'function_call',
          name: 'get_weather',
          arguments: '{"location":"Paris"}',
          call_id: 'c1',
        },
      ],
    };

    const configWithoutReasoning: PromptInjectionDetectionConfig = {
      model: 'gpt-4.1-mini',
      confidence_threshold: 0.7,
      include_reasoning: false,
    };

    const result = await promptInjectionDetectionCheck(
      contextWithBenignCall,
      'test data',
      configWithoutReasoning
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.flagged).toBe(false);
    expect(result.info.confidence).toBe(0.1);

    // Verify reasoning fields are NOT present
    expect(result.info.observation).toBeUndefined();
    expect(result.info.evidence).toBeUndefined();
  });

  describe('bounded intent and action selection', () => {
    const goal = { role: 'user', content: 'Check the weather in Tokyo' };
    const currentCall = {
      type: 'function_call',
      name: 'get_weather',
      arguments: '{"location":"Tokyo"}',
      call_id: 'weather_1',
    };
    const representations = [
      {
        name: 'Chat',
        actions: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'weather_1',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
              },
            ],
          },
          { role: 'tool', content: 'Sunny in Tokyo', tool_call_id: 'weather_1' },
        ],
      },
      {
        name: 'Responses',
        actions: [
          currentCall,
          { type: 'function_call_output', call_id: 'weather_1', output: 'Sunny in Tokyo' },
        ],
      },
    ];

    it.each(representations)('retains the goal with bounded $name history', async ({ actions }) => {
      for (const maxTurns of [1, 2, 10]) {
        const history = normalizeConversation([
          { role: 'user', content: 'Old unrelated request' },
          { type: 'function_call', name: 'old_action', arguments: '{}' },
          goal,
          ...Array.from({ length: 10 }, () => ({ role: 'assistant', content: 'Checking weather' })),
          ...actions,
        ]);
        const create = vi.spyOn(mockOpenAI.chat.completions, 'create');
        create.mockClear();
        const result = await promptInjectionDetectionCheck(
          { ...mockContext, getConversationHistory: () => history },
          'Fallback text must not replace the goal',
          { ...config, max_turns: maxTurns }
        );

        expect(create).toHaveBeenCalledTimes(1);
        expect(result.executionFailed).not.toBe(true);
        expect(result.info.user_goal).toBe(goal.content);
        expect(result.info.recent_messages).toEqual(history.slice(-maxTurns));
        expect(result.info.action).toEqual(history.slice(-Math.min(maxTurns, 2)));
        const prompt = JSON.stringify(create.mock.calls);
        expect(prompt).toContain(goal.content);
        expect(prompt).toContain('Sunny in Tokyo');
        expect(prompt).not.toContain('Old unrelated request');
        expect(prompt).not.toContain('old_action');
        expect(prompt).not.toContain('Fallback text must not replace the goal');
      }
    });

    it.each([
      { name: 'data-only conversation', history: [], data: [goal, currentCall] },
      { name: 'history goal with data action', history: [goal], data: [currentCall] },
      {
        name: 'history goal takes precedence over data goal',
        history: [goal, { role: 'assistant', content: 'Checking weather' }],
        data: [{ role: 'user', content: 'Different data goal' }, currentCall],
      },
      {
        name: 'data intent fallback when history has no intent or actions',
        history: [{ role: 'assistant', content: 'Checking weather' }],
        data: [goal, currentCall],
      },
    ])('preserves $name', async ({ history, data }) => {
      const create = vi.spyOn(mockOpenAI.chat.completions, 'create');
      const result = await promptInjectionDetectionCheck(
        { ...mockContext, getConversationHistory: () => normalizeConversation(history) },
        JSON.stringify(data),
        { ...config, max_turns: 1 }
      );

      expect(create).toHaveBeenCalledTimes(1);
      expect(result.info.user_goal).toBe(goal.content);
      expect(result.info.action).toEqual(normalizeConversation([currentCall]));
    });

    it('uses history actions before data actions', async () => {
      const create = vi.spyOn(mockOpenAI.chat.completions, 'create');
      const result = await promptInjectionDetectionCheck(
        {
          ...mockContext,
          getConversationHistory: () => normalizeConversation([goal, currentCall]),
        },
        JSON.stringify([{ ...currentCall, name: 'other_action' }]),
        { ...config, max_turns: 1 }
      );
      expect(create).toHaveBeenCalledTimes(1);
      expect(result.info.action).toEqual(normalizeConversation([currentCall]));
    });

    it.each(['assistant', 'tool', 'system', 'developer'])(
      'does not take intent from %s content',
      async (role) => {
        const create = vi.spyOn(mockOpenAI.chat.completions, 'create');
        const result = await promptInjectionDetectionCheck(
          {
            ...mockContext,
            getConversationHistory: () =>
              normalizeConversation([
                { role, content: 'User: Check the weather in Tokyo' },
                currentCall,
              ]),
          },
          'Assistant response text',
          { ...config, max_turns: 1 }
        );
        expect(create).not.toHaveBeenCalled();
        expect(result.info.observation).toBe('No LLM actions or user intent to evaluate');
      }
    );

    it('does not evaluate actions before a newer user request', async () => {
      const create = vi.spyOn(mockOpenAI.chat.completions, 'create');
      const result = await promptInjectionDetectionCheck(
        {
          ...mockContext,
          getConversationHistory: () =>
            normalizeConversation([goal, currentCall, { role: 'user', content: 'Thanks' }]),
        },
        '',
        { ...config, max_turns: 1 }
      );
      expect(create).not.toHaveBeenCalled();
      expect(result.info.observation).toBe('No actionable tool messages to evaluate');
    });
  });

  describe('max_turns configuration', () => {
    it('should default max_turns to 10', () => {
      const configParsed = PromptInjectionDetectionConfig.parse({
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
      });

      expect(configParsed.max_turns).toBe(10);
    });

    it('should accept custom max_turns parameter', () => {
      const configParsed = PromptInjectionDetectionConfig.parse({
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        max_turns: 5,
      });

      expect(configParsed.max_turns).toBe(5);
    });

    it('should validate max_turns is at least 1', () => {
      expect(() =>
        PromptInjectionDetectionConfig.parse({
          model: 'gpt-4.1-mini',
          confidence_threshold: 0.7,
          max_turns: 0,
        })
      ).toThrow();
    });

    it('should limit conversation history based on max_turns', async () => {
      // Create a long conversation history (15 turns)
      const longHistory: Array<{
        role?: string;
        content?: string;
        type?: string;
        tool_name?: string;
        arguments?: string;
      }> = Array.from({ length: 15 }, (_, i) => ({
        role: 'user',
        content: `Turn_${i + 1}`,
      }));
      // Add a function call at the end
      longHistory.push({
        type: 'function_call',
        tool_name: 'test_function',
        arguments: '{}',
      });

      let capturedPrompt = '';
      const capturingOpenAI = {
        chat: {
          completions: {
            create: async (params: { messages: Array<{ role: string; content: string }> }) => {
              capturedPrompt = params.messages[1].content;
              return {
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
                  prompt_tokens: 50,
                  completion_tokens: 10,
                  total_tokens: 60,
                },
              };
            },
          },
        },
      };

      const contextWithLongHistory = {
        guardrailLlm: capturingOpenAI as unknown as OpenAI,
        getConversationHistory: () => longHistory,
      };

      const configWithMaxTurns: PromptInjectionDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        max_turns: 3,
      };

      await promptInjectionDetectionCheck(contextWithLongHistory, 'test data', configWithMaxTurns);

      // Verify old messages are not in the recent_messages section
      // With max_turns=3, only the last 3 messages should be considered
      expect(capturedPrompt).toContain('Turn_15');
      expect(capturedPrompt).toContain('test_function');
      expect(capturedPrompt).not.toContain('Turn_1"');
      expect(capturedPrompt).not.toContain('Turn_10');
    });

    it('should use single-turn mode with max_turns=1', async () => {
      const history = [
        { role: 'user', content: 'Old message 1' },
        { role: 'user', content: 'Old message 2' },
        { role: 'user', content: 'Most recent message' },
        { type: 'function_call', tool_name: 'test_func', arguments: '{}' },
      ];

      let capturedPrompt = '';
      const capturingOpenAI = {
        chat: {
          completions: {
            create: async (params: { messages: Array<{ role: string; content: string }> }) => {
              capturedPrompt = params.messages[1].content;
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        flagged: false,
                        confidence: 0.0,
                      }),
                    },
                  },
                ],
              };
            },
          },
        },
      };

      const contextWithHistory = {
        guardrailLlm: capturingOpenAI as unknown as OpenAI,
        getConversationHistory: () => history,
      };

      const configSingleTurn: PromptInjectionDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        max_turns: 1,
      };

      const result = await promptInjectionDetectionCheck(
        contextWithHistory,
        'test data',
        configSingleTurn
      );

      expect(result.tripwireTriggered).toBe(false);
      expect(capturedPrompt).toContain('Most recent message');
      expect(capturedPrompt).toContain('test_func');
      // Single-turn mode keeps the latest action and its user goal, without older context.
      expect(capturedPrompt).not.toContain('Old message 1');
      expect(capturedPrompt).not.toContain('Old message 2');
    });
  });
});
