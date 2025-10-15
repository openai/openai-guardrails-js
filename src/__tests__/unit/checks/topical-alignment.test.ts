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

  const config = {
    model: 'gpt-topic',
    confidence_threshold: 0.6,
    system_prompt_details: 'Stay on topic about finance.',
  };

  const makeCtx = (response: any) => {
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

    const result = await topicalAlignmentCheck(ctx, 'Discussing sports', config as any);

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
      choices: [{ message: {} }],
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await topicalAlignmentCheck(ctx, 'Hi', config as any);

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

    const result = await topicalAlignmentCheck(ctx as any, 'Test', config as any);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.error).toContain('timeout');
    consoleSpy.mockRestore();
  });
});
