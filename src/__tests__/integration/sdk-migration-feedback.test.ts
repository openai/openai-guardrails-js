import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import type { OpenAI } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuardrailLLMContext } from '../../types';

const require = createRequire(import.meta.url);
const { GuardrailAgent, defaultSpecRegistry, GuardrailsOpenAI, GuardrailsAzureOpenAI } =
  require('../../..') as typeof import('../../index');
const { Runner } = require('@openai/agents') as typeof import('@openai/agents');
const { ScriptedModel, assistantMessage } =
  require('@openai/agents/testing') as typeof import('@openai/agents/testing');
const { bedrock } =
  require('openai/providers/bedrock') as typeof import('openai/providers/bedrock');
const params = { model: 'test-model', messages: [{ role: 'user' as const, content: 'Hello' }] };

function completion() {
  return new Response(
    JSON.stringify({
      id: 'test',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('SDK migration feedback', () => {
  it.each([false, true])(
    'blocks model dispatch until preflight completes, tripwire=%s',
    async (tripwireTriggered) => {
      vi.stubEnv('OPENAI_API_KEY', 'test-key');
      const name = 'Blocking migration preflight';
      let release: () => void = () => undefined;
      let markStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const check = vi.fn(async () => {
        markStarted();
        await gate;
        return { tripwireTriggered, info: {} };
      });
      defaultSpecRegistry.register(name, check, 'Blocking migration preflight');
      try {
        const model = new ScriptedModel([[assistantMessage('completed')]]);
        const dispatch = vi.spyOn(model, 'getResponse');
        const agent = await GuardrailAgent.create(
          {
            version: 1,
            pre_flight: { version: 1, guardrails: [{ name, config: {} }] },
            input: { version: 1, guardrails: [{ name, config: {} }] },
          },
          'Blocking test',
          undefined,
          { model }
        );
        const result = new Runner({ tracingDisabled: true }).run(
          agent as Parameters<InstanceType<typeof Runner>['run']>[0],
          'Hello',
          { context: { guardrailLlm: {} } }
        );
        const settled = tripwireTriggered
          ? expect(result).rejects.toThrow()
          : expect(result).resolves.toMatchObject({ finalOutput: 'completed' });
        await started;
        await setImmediate();
        expect(check).toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
        release();
        await settled;
        expect(dispatch).toHaveBeenCalledTimes(tripwireTriggered ? 0 : 1);
        expect(
          (
            agent as { inputGuardrails: Array<{ name: string; runInParallel?: boolean }> }
          ).inputGuardrails.find((guard) => guard.name.startsWith('input:'))?.runInParallel
        ).not.toBe(false);
      } finally {
        release();
        defaultSpecRegistry.remove(name);
      }
    }
  );

  it.each(['bedrock', 'workload'] as const)(
    'preserves %s authentication in guardrail context',
    async (mode) => {
      vi.stubEnv('OPENAI_API_KEY', undefined);
      vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
      const token = vi.fn().mockResolvedValue('external-token');
      const fetch = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/oauth/token')) {
          return new Response(
            JSON.stringify({
              access_token: 'exchanged-token',
              token_type: 'Bearer',
              issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
              expires_in: 3600,
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        }
        return completion();
      });
      const name = `Migration ${mode} auth`;
      let contextClient: OpenAI | undefined;
      defaultSpecRegistry.register(
        name,
        async (ctx: GuardrailLLMContext) => {
          contextClient = ctx.guardrailLlm;
          await ctx.guardrailLlm.chat.completions.create(params);
          return { tripwireTriggered: false, info: {} };
        },
        name
      );
      try {
        const auth =
          mode === 'bedrock'
            ? { provider: bedrock({ region: 'us-east-1', tokenProvider: token }) }
            : {
                workloadIdentity: {
                  identityProviderId: 'idp_test',
                  serviceAccountId: 'sa_test',
                  provider: { tokenType: 'jwt' as const, getToken: token },
                },
              };
        const client = await GuardrailsOpenAI.create(
          { version: 1, pre_flight: { version: 1, guardrails: [{ name, config: {} }] } },
          { ...auth, fetch, maxRetries: 0 },
          true
        );
        expect(token).not.toHaveBeenCalled();
        await client.withOptions({ timeout: 1234 }).chat.completions.create(params);
        expect(contextClient).not.toBe(client);
        const calls = fetch.mock.calls.filter(([url]) => !String(url).includes('/oauth/token'));
        expect(calls).toHaveLength(2);
        for (const call of calls) {
          const init = (call as unknown as [unknown, RequestInit])[1];
          expect(new Headers(init.headers).get('authorization')).toBe(
            mode === 'bedrock' ? 'Bearer external-token' : 'Bearer exchanged-token'
          );
          expect(String(call[0])).toContain(
            mode === 'bedrock' ? 'bedrock-mantle' : 'api.openai.com'
          );
        }
      } finally {
        defaultSpecRegistry.remove(name);
      }
    }
  );

  it.each(['openai', 'azure'] as const)(
    'preserves initialized guards and options when cloning %s',
    async (mode) => {
      vi.stubEnv('OPENAI_API_KEY', undefined);
      vi.stubEnv('OPENAI_ADMIN_KEY', undefined);
      vi.stubEnv('AZURE_OPENAI_API_KEY', undefined);
      vi.stubEnv('OPENAI_API_VERSION', undefined);
      const originalFetch = vi.fn(async () => completion());
      const cloneFetch = vi.fn(async () => completion());
      const check = vi.fn(() => ({ tripwireTriggered: false, info: {} }));
      const name = `Migration clone ${mode}`;
      defaultSpecRegistry.register(name, check, name);
      try {
        const config = {
          version: 1,
          pre_flight: { version: 1, guardrails: [{ name, config: {} }] },
        };
        const original =
          mode === 'azure'
            ? await GuardrailsAzureOpenAI.create(
                config,
                {
                  apiKey: 'original',
                  endpoint: 'https://example.openai.azure.com',
                  apiVersion: '2025-01-01-preview',
                  deployment: 'test-deployment',
                  fetch: originalFetch,
                },
                true
              )
            : await GuardrailsOpenAI.create(
                config,
                { apiKey: 'original', fetch: originalFetch },
                true
              );
        const cloned = original
          .withOptions({
            apiKey: 'cloned',
            fetch: cloneFetch,
            timeout: 1234,
            maxRetries: 0,
            defaultHeaders: { 'x-cloned': 'yes' },
          })
          .withOptions({});
        expect(cloned).toBeInstanceOf(original.constructor);
        expect(cloned).not.toBe(original);
        expect(cloned.timeout).toBe(1234);
        await cloned.guardrails.chat.completions.create(params);
        await original.guardrails.chat.completions.create(params);
        expect(check).toHaveBeenCalledTimes(2);
        expect(cloneFetch).toHaveBeenCalledOnce();
        expect(originalFetch).toHaveBeenCalledOnce();
        const [url, init] = cloneFetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(new Headers(init.headers).get('x-cloned')).toBe('yes');
        expect(new Headers(init.headers).get(mode === 'azure' ? 'api-key' : 'authorization')).toBe(
          mode === 'azure' ? 'cloned' : 'Bearer cloned'
        );
        if (mode === 'azure') {
          expect(String(url)).toContain('/deployments/test-deployment/');
          expect(String(url)).toContain('api-version=2025-01-01-preview');
        }
        check.mockImplementation(() => {
          throw new Error('guardrail failed');
        });
        await expect(cloned.chat.completions.create(params)).rejects.toThrow('guardrail failed');
        expect(cloneFetch).toHaveBeenCalledOnce();
      } finally {
        defaultSpecRegistry.remove(name);
      }
    }
  );
});
