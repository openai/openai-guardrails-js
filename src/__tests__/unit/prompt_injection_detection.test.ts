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
    expect(result.info.observation).toBe('No conversation history available');
    expect(result.info.guardrail_name).toBe('Prompt Injection Detection');
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
    expect(result.info.observation).toBe('No conversation history available');
  });
});
