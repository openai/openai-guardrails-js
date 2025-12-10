/**
 * Unit tests for the prompt injection detection guardrail.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpenAI } from 'openai';
import {
  promptInjectionDetectionCheck,
  PromptInjectionDetectionConfig,
} from '../../checks/prompt_injection_detection';
import { GuardrailLLMContextWithHistory } from '../../types';

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

    const result = await promptInjectionDetectionCheck(
      contextWithEmptyOutput,
      'test data',
      config
    );

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
        { type: 'function_call', name: 'get_weather', arguments: '{"location":"Paris"}', call_id: 'c1' },
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
});
