import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

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
  it('runs real Agents input and output guardrails with session history', async () => {
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
