/**
 * Tests for the topical alignment guardrail.
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
  LLMOutput: {},
}));

vi.mock('../../../registry', () => ({
  defaultSpecRegistry: {
    register: registerMock,
  },
}));

describe('topicalAlignment guardrail', () => {
  beforeEach(() => {
    registerMock.mockClear();
    createLLMCheckFnMock.mockClear();
  });

  it('is created via createLLMCheckFn', async () => {
    const { topicalAlignment } = await import('../../../checks/topical-alignment');

    expect(topicalAlignment).toBe('mocked-guardrail');
    expect(createLLMCheckFnMock).toHaveBeenCalled();
  });
});

describe('topicalAlignment integration tests', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  interface TopicalAlignmentConfig {
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
      } as GuardrailLLMContext,
      create,
    };
  };

  it('triggers when LLM flags off-topic content above threshold with gpt-4', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: true, confidence: 0.8 }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: TopicalAlignmentConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Stay on topic about finance.',
    };

    const result = await topicalAlignment(ctx, 'Discussing sports', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-4');
    expect(params.temperature).toBe(0.0); // gpt-4 uses temperature 0
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.8);
  });

  it('uses temperature 1.0 for gpt-5 models (which do not support temperature 0)', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
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

    const config: TopicalAlignmentConfig = {
      model: 'gpt-5',
      confidence_threshold: 0.7,
      system_prompt_details: 'Stay on topic about technology.',
    };

    const result = await topicalAlignment(ctx, 'Discussing AI and ML', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-5');
    expect(params.temperature).toBe(1.0); // gpt-5 uses temperature 1.0, not 0
    expect(params.response_format).toEqual({ type: 'json_object' });
    expect(result.tripwireTriggered).toBe(false);
  });

  it('works with gpt-4o model', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
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

    const config: TopicalAlignmentConfig = {
      model: 'gpt-4o',
      confidence_threshold: 0.8,
      system_prompt_details: 'Stay on topic about healthcare.',
    };

    const result = await topicalAlignment(ctx, 'Talking about cars', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-4o');
    expect(params.temperature).toBe(0.0); // gpt-4o uses temperature 0
    expect(result.tripwireTriggered).toBe(true);
  });

  it('works with gpt-3.5-turbo model', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
    const capturedParams: { value?: unknown } = {};
    const { ctx, create } = makeCtx(
      {
        choices: [
          {
            message: {
              content: JSON.stringify({ flagged: false, confidence: 0.3 }),
            },
          },
        ],
      },
      capturedParams
    );

    const config: TopicalAlignmentConfig = {
      model: 'gpt-3.5-turbo',
      confidence_threshold: 0.7,
      system_prompt_details: 'Stay on topic about education.',
    };

    const result = await topicalAlignment(ctx, 'Discussing teaching methods', config);

    expect(create).toHaveBeenCalled();
    const params = capturedParams.value as Record<string, unknown>;
    expect(params.model).toBe('gpt-3.5-turbo');
    expect(params.temperature).toBe(0.0);
    expect(result.tripwireTriggered).toBe(false);
  });

  it('does not trigger when confidence is below threshold', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
    const { ctx } = makeCtx({
      choices: [
        {
          message: {
            content: JSON.stringify({ flagged: true, confidence: 0.5 }),
          },
        },
      ],
    });

    const config: TopicalAlignmentConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Stay on topic about finance.',
    };

    const result = await topicalAlignment(ctx, 'Maybe off topic', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.flagged).toBe(true);
    expect(result.info?.confidence).toBe(0.5);
  });

  it('handles execution failures gracefully', async () => {
    vi.doUnmock('../../../checks/llm-base');
    vi.doUnmock('../../../checks/topical-alignment');
    
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { topicalAlignment } = await import('../../../checks/topical-alignment');
    const ctx = {
      guardrailLlm: {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue(new Error('API timeout')),
          },
        },
        baseURL: 'https://api.openai.com/v1',
      },
    } as GuardrailLLMContext;

    const config: TopicalAlignmentConfig = {
      model: 'gpt-4',
      confidence_threshold: 0.7,
      system_prompt_details: 'Stay on topic about finance.',
    };

    const result = await topicalAlignment(ctx, 'Test text', config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    consoleSpy.mockRestore();
  });
});
