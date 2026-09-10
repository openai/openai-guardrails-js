import { createRequire } from 'node:module';
import type { OpenAI } from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { GuardrailLLMContext } from '../../types';

// Exercise the published CommonJS entry and its actual dependency identities.
// Run `npm run build` first, as CI does; source-only mocks miss Runner patches.
const require = createRequire(import.meta.url);
const { GuardrailAgent, defaultSpecRegistry, GuardrailsOpenAI, GuardrailsAzureOpenAI } =
  require('../../..') as typeof import('../../index');
const { MemorySession, Runner } = require('@openai/agents') as typeof import('@openai/agents');
const { ScriptedModel, assistantMessage } =
  require('@openai/agents/testing') as typeof import('@openai/agents/testing');
const { z } = require('zod') as typeof import('zod');
const { zodResponseFormat } = require('openai/helpers/zod') as typeof import('openai/helpers/zod');

describe('published SDK compatibility', () => {
  it('preserves lazy rotating API-key callbacks for the separate guardrail client', async () => {
    vi.stubEnv('OPENAI_API_KEY', undefined);
    vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
    const apiKey = vi
      .fn()
      .mockResolvedValueOnce('test-main')
      .mockResolvedValueOnce('test-guardrail-1')
      .mockResolvedValueOnce('test-guardrail-2');
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [
              { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    );
    let guardrailClient: OpenAI | undefined;
    const name = 'Capture credential client';
    defaultSpecRegistry.register(
      name,
      (ctx: GuardrailLLMContext) => {
        guardrailClient = ctx.guardrailLlm;
        return { tripwireTriggered: false, info: {} };
      },
      'Capture credential client'
    );
    try {
      const client = await GuardrailsOpenAI.create(
        {
          version: 1,
          pre_flight: { version: 1, guardrails: [{ name, config: {} }] },
        },
        { apiKey, fetch, maxRetries: 0 }
      );
      expect(apiKey).not.toHaveBeenCalled();
      const params = {
        model: 'test-model',
        messages: [{ role: 'user' as const, content: 'Hello' }],
      };
      await client.chat.completions.create(params);
      expect(guardrailClient).toBeDefined();
      if (!guardrailClient) throw new Error('Guardrail context was not captured');
      expect(guardrailClient).not.toBe(client);
      expect(guardrailClient.apiKey).toBeNull();
      expect(guardrailClient.fetch).toBe(fetch);
      await guardrailClient.chat.completions.create(params);
      await guardrailClient.chat.completions.create(params);
      expect(apiKey).toHaveBeenCalledTimes(3);
      expect(
        fetch.mock.calls.map(([, init]) => new Headers(init.headers).get('authorization'))
      ).toEqual(['Bearer test-main', 'Bearer test-guardrail-1', 'Bearer test-guardrail-2']);
      apiKey.mockRejectedValueOnce(new Error('credential unavailable'));
      await expect(guardrailClient.chat.completions.create(params)).rejects.toThrow(
        'credential unavailable'
      );
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      defaultSpecRegistry.remove(name);
      vi.unstubAllEnvs();
    }
  });

  it('runs real Agents input and output guardrails with session history', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const seen: Array<{ text: string; history: unknown }> = [];
    const name = 'SDK migration history';
    defaultSpecRegistry.register(
      name,
      (ctx: { getConversationHistory?: () => unknown }, text: string) => {
        seen.push({ text, history: ctx.getConversationHistory?.() });
        return { tripwireTriggered: false, info: {} };
      },
      'Capture history',
      'text/plain',
      z.object({}),
      z.object({}).passthrough(),
      { usesConversationHistory: true }
    );
    try {
      const model = new ScriptedModel([[assistantMessage('Current answer')]]);
      const agent = await GuardrailAgent.create(
        {
          version: 1,
          input: { version: 1, guardrails: [{ name, config: {} }] },
          output: { version: 1, guardrails: [{ name, config: {} }] },
        },
        'Session test',
        undefined,
        { model },
        true
      );
      const session = new MemorySession({
        initialItems: [
          { role: 'user', content: 'Earlier question' },
          assistantMessage('Earlier answer'),
        ],
      });
      const result = await new Runner({ tracingDisabled: true }).run(
        agent as Parameters<InstanceType<typeof Runner>['run']>[0],
        'Current question',
        { session, context: { guardrailLlm: {} } }
      );
      expect(result.finalOutput).toBe('Current answer');
      expect(seen.map((entry) => entry.text)).toEqual(['Current question', 'Current answer']);
      for (const entry of seen) {
        expect(entry.history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Earlier question' }),
            expect.objectContaining({ role: 'assistant', content: 'Earlier answer' }),
            expect.objectContaining({ role: 'user', content: 'Current question' }),
          ])
        );
      }
      expect(seen[1].history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'Current answer' }),
        ])
      );
      model.assertComplete();
    } finally {
      defaultSpecRegistry.remove(name);
      vi.unstubAllEnvs();
    }
  });

  it.each(['openai', 'azure'] as const)(
    'uses %s with native fetch, request options, and Zod 4 structured output',
    async (provider) => {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: '{"answer":"ok"}' },
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      const config = { version: 1 };
      const client =
        provider === 'azure'
          ? await GuardrailsAzureOpenAI.create(config, {
              apiKey: 'test-key',
              endpoint: 'https://example.openai.azure.com',
              apiVersion: '2025-01-01-preview',
              fetch,
            })
          : await GuardrailsOpenAI.create(config, { apiKey: 'test-key', fetch });
      const response = await client.chat.completions.create(
        {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
          response_format: zodResponseFormat(z.object({ answer: z.string() }), 'answer'),
        },
        { headers: { 'x-migration-test': 'yes' }, maxRetries: 0 }
      );
      expect(response.choices[0].message.content).toBe('{"answer":"ok"}');
      const [url, init] = fetch.mock.calls[0];
      expect(new Headers(init.headers).get('x-migration-test')).toBe('yes');
      expect(String(url)).toContain(
        provider === 'azure' ? 'example.openai.azure.com' : 'api.openai.com'
      );
      expect(JSON.parse(init.body).response_format.json_schema.schema.required).toEqual(['answer']);
    }
  );
});
