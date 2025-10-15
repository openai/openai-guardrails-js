/**
 * Tests for the user-defined LLM guardrail.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  userDefinedLLMCheck,
  UserDefinedConfig,
  UserDefinedContext,
} from '../../../checks/user-defined-llm';

const makeCtx = () => {
  const create = vi.fn();
  const ctx: UserDefinedContext = {
    guardrailLlm: {
      chat: {
        completions: {
          create,
        },
      },
    },
  };
  return { ctx, create };
};

const config = UserDefinedConfig.parse({
  model: 'gpt-test',
  confidence_threshold: 0.7,
  system_prompt_details: 'Only allow positive comments.',
});

describe('userDefinedLLMCheck', () => {
  it('triggers tripwire when flagged above threshold from JSON response', async () => {
    const { ctx, create } = makeCtx();
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ flagged: true, confidence: 0.95, reason: 'negative tone' }),
          },
        },
      ],
    });

    const result = await userDefinedLLMCheck(ctx, 'This is bad.', config);

    expect(create).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: expect.stringContaining('Only allow positive comments.') },
        { role: 'user', content: 'This is bad.' },
      ],
      model: 'gpt-test',
      temperature: 0.0,
      response_format: { type: 'json_object' },
    });
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.95);
    expect(result.info?.reason).toBe('negative tone');
  });

  it('falls back to text parsing when response_format is unsupported', async () => {
    const { ctx, create } = makeCtx();
    const errorObj = new Error('format not supported') as any;
    errorObj.error = { param: 'response_format' };
    create.mockRejectedValueOnce(errorObj);
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: 'flagged: false, confidence: 0.4, reason: "acceptable"',
          },
        },
      ],
    });

    const result = await userDefinedLLMCheck(ctx, 'All good here.', config);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.flagged).toBe(false);
    expect(result.info?.confidence).toBe(0.4);
    expect(result.info?.reason).toBe('acceptable');
  });

  it('returns execution failure metadata when other errors occur', async () => {
    const { ctx, create } = makeCtx();
    create.mockRejectedValueOnce(new Error('network down'));

    const result = await userDefinedLLMCheck(ctx, 'Hello', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    expect(result.info?.error_message).toContain('network down');
  });

  it('handles missing content gracefully', async () => {
    const { ctx, create } = makeCtx();
    create.mockResolvedValue({ choices: [{ message: {} }] });

    const result = await userDefinedLLMCheck(ctx, 'Test', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    expect(result.info?.error_message).toBe('No response content from LLM');
  });
});
