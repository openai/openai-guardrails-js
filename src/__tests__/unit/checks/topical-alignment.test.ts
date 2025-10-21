/**
 * Tests for the topical alignment guardrail.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

const buildFullPromptMock = vi.fn((prompt: string) => `FULL:${prompt}`);
const registerMock = vi.fn();

vi.mock('../../../checks/llm-base', () => ({
  buildFullPrompt: buildFullPromptMock,
}));

vi.mock('../../../registry', () => ({
  defaultSpecRegistry: {
    register: registerMock,
  },
}));

describe('topicalAlignmentCheck', () => {
  afterEach(() => {
    buildFullPromptMock.mockClear();
  });

  interface TopicalAlignmentConfig {
    model: string;
    confidence_threshold: number;
    system_prompt_details: string;
  }

  const config: TopicalAlignmentConfig = {
    model: 'gpt-topic',
    confidence_threshold: 0.6,
    system_prompt_details: 'Stay on topic about finance.',
  };

  interface MockLLMResponse {
    choices: Array<{
      message: {
        content: string;
      };
    }>;
  }

  const makeCtx = (response: MockLLMResponse) => {
    const create = vi.fn().mockResolvedValue(response);
    return {
      ctx: {
        guardrailLlm: {
          chat: {
            completions: {
              create,
            },
          },
        },
      },
      create,
    };
  };

  it('triggers when LLM flags off-topic content above threshold', async () => {
    const { topicalAlignmentCheck } = await import('../../../checks/topical-alignment');
    const { ctx, create } = makeCtx({
      choices: [
        {
          message: {
            content: JSON.stringify({ flagged: true, confidence: 0.8 }),
          },
        },
      ],
    });

    const result = await topicalAlignmentCheck(ctx, 'Discussing sports', config);

    expect(buildFullPromptMock).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: expect.stringContaining('Stay on topic about finance.') },
        { role: 'user', content: 'Discussing sports' },
      ],
      model: 'gpt-topic',
      temperature: 0.0,
      response_format: { type: 'json_object' },
    });
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.8);
  });

  it('returns failure info when no content is returned', async () => {
    const { topicalAlignmentCheck } = await import('../../../checks/topical-alignment');
    const { ctx } = makeCtx({
      choices: [{ message: { content: '' } }],
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await topicalAlignmentCheck(ctx, 'Hi', config);

    consoleSpy.mockRestore();

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.error).toBeDefined();
  });

  it('handles unexpected errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { topicalAlignmentCheck } = await import('../../../checks/topical-alignment');
    const ctx = {
      guardrailLlm: {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('timeout')),
          },
        },
      },
    };

    interface MockContext {
      guardrailLlm: {
        chat: {
          completions: {
            create: ReturnType<typeof vi.fn>;
          };
        };
      };
    }
    
    const result = await topicalAlignmentCheck(ctx as MockContext, 'Test', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.error).toContain('timeout');
    consoleSpy.mockRestore();
  });
});
