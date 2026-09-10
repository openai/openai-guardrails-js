import { inspect } from 'node:util';
import { AzureOpenAI, OpenAI } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { jailbreak } from '../../checks/jailbreak';
import { LLMConfig, LLMOutput, runLLM } from '../../checks/llm-base';

const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };

function mockCompletion(client: OpenAI, content: string | null) {
  return vi.spyOn(client.chat.completions, 'create').mockResolvedValue({
    id: 'test-completion',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-4.1-mini',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal: null,
        },
      },
    ],
    usage,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Jailbreak response format', () => {
  it.each([
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4.1-2025-04-14',
    'gpt-4.1-mini-2025-04-14',
    'gpt-4.1-nano-2025-04-14',
  ])('requires the decision fields on %s for benign input', async (model) => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const create = mockCompletion(client, JSON.stringify({ flagged: false, confidence: 0.1 }));

    const result = await jailbreak({ guardrailLlm: client }, 'Hello!', LLMConfig.parse({ model }));

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toMatchObject({
      model,
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            properties: {
              flagged: { type: 'boolean' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['flagged', 'confidence'],
            additionalProperties: false,
          },
        },
      },
    });
    expect(result.executionFailed).not.toBe(true);
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.token_usage).toEqual(usage);
  });

  it.each([false, true])('requires reasoning when enabled, flagged=%s', async (flagged) => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const create = mockCompletion(
      client,
      JSON.stringify({ flagged, confidence: 0.9, reason: 'Analysis.' })
    );
    const result = await jailbreak(
      { guardrailLlm: client },
      'Example text',
      LLMConfig.parse({
        model: 'gpt-4.1-mini',
        include_reasoning: true,
      })
    );

    expect(create.mock.calls[0][0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          schema: {
            properties: { reason: { type: 'string' } },
            required: ['flagged', 'confidence', 'reason'],
          },
        },
      },
    });
    expect(result.executionFailed).not.toBe(true);
    expect(result.tripwireTriggered).toBe(flagged);
    expect(result.info.reason).toBe('Analysis.');
  });

  it.each(['gpt-4', 'gpt-4o', 'gpt-4.1-mini-custom', 'ft:gpt-4.1-mini-2025-04-14:custom'])(
    'retains JSON mode for other models: %s',
    async (model) => {
      const client = new OpenAI({ apiKey: 'test-key' });
      const create = mockCompletion(client, '{"flagged":false,"confidence":0.1}');
      await jailbreak({ guardrailLlm: client }, 'Hello!', LLMConfig.parse({ model }));
      expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
    }
  );

  it.each(['azure', 'custom'])('retains JSON mode for %s providers', async (provider) => {
    const client =
      provider === 'azure'
        ? new AzureOpenAI({
            apiKey: 'test-key',
            endpoint: 'https://example.openai.azure.com',
            apiVersion: '2024-10-21',
          })
        : new OpenAI({ apiKey: 'test-key', baseURL: 'http://localhost:11434/v1' });
    const create = mockCompletion(client, '{"flagged":false,"confidence":0.1}');
    await jailbreak({ guardrailLlm: client }, 'Hello!', LLMConfig.parse({ model: 'gpt-4.1-mini' }));
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
  });

  it('preserves custom output schema behavior', async () => {
    const client = new OpenAI({ apiKey: 'test-key' });
    const create = mockCompletion(client, '{"flagged":false,"confidence":0.1}');
    const outputModel = LLMOutput.extend({ detail: z.string().optional() });
    const [result] = await runLLM('Hello!', 'Check the input', client, 'gpt-4.1-mini', outputModel);
    expect(create.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
    expect(result).toEqual({ flagged: false, confidence: 0.1 });
  });
});

describe('LLM failure logging', () => {
  it.each([
    ['{}', 'LLM response validation failed.'],
    ['{"flagged":false,"confidence":"0.1"}', 'LLM response validation failed.'],
    ['not JSON', 'LLM returned non-JSON or malformed JSON.'],
    [null, 'LLM returned no content'],
  ])('preserves failure diagnostics and usage for %s', async (content, message) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new OpenAI({ apiKey: 'test-key' });
    mockCompletion(client, content);

    const result = await jailbreak(
      { guardrailLlm: client },
      'Hello!',
      LLMConfig.parse({ model: 'gpt-4.1-mini' })
    );

    expect(result.executionFailed).toBe(true);
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info.error_message).toBe(message);
    expect(result.info.token_usage).toEqual(usage);
    if (content === '{}') {
      expect(result.info.zod_issues).toEqual([
        expect.objectContaining({ path: ['flagged'], code: 'invalid_type' }),
        expect.objectContaining({ path: ['confidence'], code: 'invalid_type' }),
      ]);
    }
    for (const args of [...errorLog.mock.calls, ...warningLog.mock.calls]) {
      expect(args.every((arg) => typeof arg === 'string')).toBe(true);
    }
  });

  it('does not invoke an exception object inspector', async () => {
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      for (const arg of args) inspect(arg);
    });
    const failure = new Error('Provider unavailable');
    const inspector = vi.fn(() => {
      throw new Error('Inspector failed');
    });
    Object.defineProperty(failure, inspect.custom, { value: inspector });
    const client = new OpenAI({ apiKey: 'test-key' });
    vi.spyOn(client.chat.completions, 'create').mockRejectedValue(failure);

    const result = await jailbreak(
      { guardrailLlm: client },
      'Hello!',
      LLMConfig.parse({ model: 'gpt-4.1-mini' })
    );

    expect(result.executionFailed).toBe(true);
    expect(result.info.error_message).toContain('Provider unavailable');
    expect(inspector).not.toHaveBeenCalled();
  });
});
