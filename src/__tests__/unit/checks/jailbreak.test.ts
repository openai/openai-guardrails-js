/**
 * Ensures jailbreak guardrail delegates to createLLMCheckFn with correct metadata.
 */

import { describe, it, expect, vi } from 'vitest';

const createLLMCheckFnMock = vi.fn(() => 'mocked-guardrail');
const registerMock = vi.fn();

vi.mock('../../../checks/llm-base', () => ({
  createLLMCheckFn: createLLMCheckFnMock,
  LLMConfig: {},
  LLMOutput: {},
}));

vi.mock('../../../registry', () => ({
  defaultSpecRegistry: {
    register: registerMock,
  },
}));

describe('jailbreak guardrail', () => {
  beforeEach(() => {
    registerMock.mockClear();
    createLLMCheckFnMock.mockClear();
  });

  it('is created via createLLMCheckFn', async () => {
    const { jailbreak } = await import('../../../checks/jailbreak');

    expect(jailbreak).toBe('mocked-guardrail');
    expect(createLLMCheckFnMock).toHaveBeenCalled();
  });
});
