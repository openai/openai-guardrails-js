/**
 * Tests for the user-defined LLM guardrail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuardrailLLMContext } from '../../../types';

const createLLMCheckFnMock = vi.fn(() => 'mocked-guardrail');
const registerMock = vi.fn();

vi.mock('../../../checks/llm-base', () => ({
  createLLMCheckFn: createLLMCheckFnMock,
  LLMConfig: {
    omit: vi.fn(() => ({
      extend: vi.fn(() => ({})),
    })),
  },
  LLMOutput: {
    extend: vi.fn(() => ({})),
  },
}));

vi.mock('../../../registry', () => ({
  defaultSpecRegistry: {
    register: registerMock,
  },
}));

describe('userDefinedLLM guardrail', () => {
  beforeEach(() => {
    registerMock.mockClear();
    createLLMCheckFnMock.mockClear();
  });

  it('is created via createLLMCheckFn', async () => {
    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');

    expect(userDefinedLLM).toBe('mocked-guardrail');
    expect(createLLMCheckFnMock).toHaveBeenCalled();
  });
});

describe('userDefinedLLM integration tests', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  interface UserDefinedConfig {
    model: string;
    confidence_threshold: number;
    system_prompt_details: string;
  }

  interface MockLLMResponse {
    choices: Array<{
      message: {
        content: string;
      };
    }>;
  }

  const makeCtx = (response: MockLLMResponse, capturedParams?: { value?: unknown }) => {
    const create = vi.fn().mockImplementation((params) => {
      if (capturedParams) {
        capturedParams.value = params;
      }
      return Promise.resolve(response);
    });
    return {
      ctx: {
        guardrailLlm: {
          chat: {
            completions: {
              create,
            },
          },
          baseURL: 'https://api.openai.com/v1',
        },
      } as unknown as GuardrailLLMContext,
      create,
    };
  };

  it('triggers tripwire when flagged above threshold with gpt-4', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: true, confidence: 0.95, reason: 'negative tone' }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: UserDefinedConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Only allow positive comments.',
    };

    const result = await userDefinedLLM(ctx, 'This is bad.', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-4');
    expect(params.temperature).toBe(0.0);
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.95);
  });

  it('uses temperature 1.0 for gpt-5 models', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: false, confidence: 0.2 }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: UserDefinedConfig = {
      model: 'gpt-5',
      confidence_threshold: 0.7,
      system_prompt_details: 'Only allow technical content.',
    };

    const result = await userDefinedLLM(ctx, 'This is technical content.', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-5');
    expect(params.temperature).toBe(1.0); // gpt-5 uses temperature 1.0
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(result.tripwireTriggered).toBe(false);
  });

  it('works with gpt-4o model', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: true, confidence: 0.9 }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: UserDefinedConfig = {
      model: 'gpt-4o',
      confidence_threshold: 0.8,
      system_prompt_details: 'Flag inappropriate language.',
    };

    const result = await userDefinedLLM(ctx, 'Bad words here', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-4o');
    expect(params.temperature).toBe(0.0);
    expect(result.tripwireTriggered).toBe(true);
  });

  it('works with gpt-3.5-turbo model', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: false, confidence: 0.1 }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: UserDefinedConfig = {
      model: 'gpt-3.5-turbo',
      confidence_threshold: 0.7,
      system_prompt_details: 'Check for spam.',
    };

    const result = await userDefinedLLM(ctx, 'Normal message', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-3.5-turbo');
    expect(params.temperature).toBe(0.0);
    expect(result.tripwireTriggered).toBe(false);
  });

  it('does not trigger when confidence is below threshold', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const { ctx } = makeCtx({
      choices: [
        {
          message: {
            content: JSON.stringify({ flagged: true, confidence: 0.5 }),
          },
        },
      ],
    });

    const config: UserDefinedConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Custom check.',
    };

    const result = await userDefinedLLM(ctx, 'Maybe problematic', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.5);
  });

  it('handles execution failures gracefully', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const ctx = {
      guardrailLlm: {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('Network error')),
          },
        },
        baseURL: 'https://api.openai.com/v1',
      },
    } as unknown as GuardrailLLMContext;

    const config: UserDefinedConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Custom check.',
    };

    const result = await userDefinedLLM(ctx, 'Test text', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    consoleSpy.mockRestore();
  });

  it('supports optional reason field in output when include_reasoning is enabled', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/user-defined-llm');

    const { userDefinedLLM } = await import('../../../checks/user-defined-llm');
    const { ctx } = makeCtx({
      choices: [
        {
          message: {
            content: JSON.stringify({
              flagged: true,
              confidence: 0.9,
              reason: 'Contains profanity',
            }),
          },
        },
      ],
    });

    const config = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Flag profanity.',
      include_reasoning: true,
    };

    const result = await userDefinedLLM(ctx, 'Bad words', config);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.reason).toBe('Contains profanity');
  });
});
