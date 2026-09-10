import assert from 'node:assert/strict';
import { OpenAI } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuardrailsBaseClient, type GuardrailsResponse } from '../../base-client';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { GuardrailRegistry } from '../../registry';
import { Chat } from '../../resources/chat';
import { Responses } from '../../resources/responses';
import { StreamingMixin } from '../../streaming';
import type { GuardrailLLMContext, GuardrailResult } from '../../types';

class OutputTestClient extends GuardrailsBaseClient {
  constructor(
    check: () => GuardrailResult | Promise<GuardrailResult>,
    strict: boolean | undefined
  ) {
    super();
    const registry = new GuardrailRegistry();
    registry.register('Output fixture', vi.fn(check), 'Inert output check');
    const spec = registry.get('Output fixture');
    assert(spec);
    this.guardrails = {
      pre_flight: [],
      input: [],
      output: [spec.instantiate({})],
    };
    this._resourceClient = new OpenAI({ apiKey: 'test-key' });
    this.context = this.createDefaultContext();
    if (strict !== undefined) this.raiseGuardrailErrors = strict;
    vi.spyOn(this._resourceClient.chat.completions, 'create').mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello' } }],
    } as OpenAI.Chat.Completions.ChatCompletion);
    vi.spyOn(this._resourceClient.responses, 'create').mockResolvedValue({
      output: [],
      output_text: 'Hello',
    } as unknown as OpenAI.Responses.Response);
  }

  protected createDefaultContext(): GuardrailLLMContext {
    return { guardrailLlm: this._resourceClient };
  }

  protected overrideResources(): void {
    /* Resources are constructed explicitly below. */
  }
}

describe('output execution-error policy', () => {
  afterEach(() => vi.restoreAllMocks());

  for (const failureKind of [
    'throw',
    'result',
    'result without exception',
    'tripwire throw',
    'tripwire result',
  ] as const) {
    for (const strict of [true, false, undefined]) {
      describe(`${failureKind}, strict=${strict}`, () => {
        const setup = () => {
          vi.spyOn(console, 'error').mockImplementation(() => undefined);
          const error = failureKind.startsWith('tripwire')
            ? Object.freeze(new GuardrailTripwireTriggered({ tripwireTriggered: true, info: {} }))
            : new Error('Inert check unavailable');
          const client = new OutputTestClient(() => {
            if (failureKind === 'throw' || failureKind === 'tripwire throw') throw error;
            return {
              tripwireTriggered: false,
              executionFailed: true,
              ...(failureKind === 'result without exception' ? {} : { originalException: error }),
              info: {},
            };
          }, strict);
          return { client, error };
        };

        for (const suppressTripwire of [false, true]) {
          for (const api of ['chat', 'responses'] as const) {
            it(`${api} non-streaming, suppressTripwire=${suppressTripwire}`, async () => {
              const { client, error } = setup();
              const response =
                api === 'chat'
                  ? new Chat(client).completions.create({
                      model: 'test-model',
                      messages: [{ role: 'user', content: 'Hi' }],
                      suppressTripwire,
                    })
                  : new Responses(client).create({
                      model: 'test-model',
                      input: 'Hi',
                      suppressTripwire,
                    });
              if (strict) {
                if (failureKind === 'result without exception') {
                  await expect(response).rejects.toThrow('Guardrail execution failed');
                } else {
                  await expect(response).rejects.toBe(error);
                }
              } else {
                const result = (await response).guardrail_results.output[0];
                expect(result.executionFailed).toBe(true);
                expect(result.originalException).toBe(
                  failureKind === 'result without exception' ? undefined : error
                );
              }
            });
          }
        }

        for (const [checkpoint, interval, suppressTripwire] of [
          ['periodic', 1, false],
          ['periodic suppressed', 1, true],
          ['final', 100, false],
          ['final suppressed', 100, true],
        ] as const) {
          it(`streaming ${checkpoint}`, async () => {
            const { client, error } = setup();
            async function* chunks() {
              yield { choices: [{ delta: { content: 'Hello' } }] };
            }
            const iterator = new StreamingMixin().streamWithGuardrails.call(
              client,
              chunks(),
              [],
              [],
              [],
              interval,
              suppressTripwire
            );
            const yielded: GuardrailsResponse[] = [];
            const consume = async () => {
              for await (const response of iterator) yielded.push(response);
            };
            if (strict) {
              if (failureKind === 'result without exception') {
                await expect(consume()).rejects.toThrow('Guardrail execution failed');
              } else {
                await expect(consume()).rejects.toBe(error);
              }
              // A final check can fail after chunks were streamed, but emits no successful final result.
              expect(yielded).toHaveLength(interval === 1 ? 0 : 1);
            } else {
              await consume();
              expect(yielded).toHaveLength(suppressTripwire ? 1 : 2);
              if (!suppressTripwire) {
                const result = yielded[1].guardrail_results.output[0];
                expect(result.executionFailed).toBe(true);
                expect(result.originalException).toBe(
                  failureKind === 'result without exception' ? undefined : error
                );
              }
            }
          });
        }
      });
    }
  }

  for (const strict of [true, false, undefined]) {
    for (const tripwireTriggered of [false, true]) {
      it(`preserves suppressed short-stream output with strict=${strict}, tripwire=${tripwireTriggered}`, async () => {
        const check = vi.fn(() => ({ tripwireTriggered, info: {} }));
        const client = new OutputTestClient(check, strict);
        const chunk = { choices: [{ delta: { content: 'Hello' } }] };
        async function* chunks() {
          yield chunk;
        }
        const yielded: GuardrailsResponse[] = [];
        for await (const response of StreamingMixin.streamWithGuardrailsSync(
          client,
          chunks(),
          [],
          [],
          [],
          true
        )) {
          yielded.push(response);
        }
        expect(check).toHaveBeenCalledTimes(strict ? 1 : 0);
        expect(yielded).toHaveLength(1);
        expect(yielded[0]).toMatchObject(chunk);
        expect(yielded[0].guardrail_results.output).toEqual([]);
      });
    }
  }

  for (const api of ['chat', 'responses'] as const) {
    for (const count of [99, 100, 101, 200]) {
      for (const suppressTripwire of [false, true]) {
        it(`${api}: checks only pending suppressed text after ${count} chunks, suppression=${suppressTripwire}`, async () => {
          const check = vi.fn(() => ({ tripwireTriggered: false, info: {} }));
          const client = new OutputTestClient(check, true);
          async function* chunks() {
            for (let index = 0; index < count; index++) {
              yield api === 'chat'
                ? { choices: [{ delta: { content: 'Hello' } }] }
                : { type: 'response.output_text.delta', delta: 'Hello' };
            }
            yield { type: 'response.output_text.delta', delta: '' };
            yield { type: 'response.output_text.done', text: 'Hello' };
          }
          const yielded: GuardrailsResponse[] = [];
          for await (const response of StreamingMixin.streamWithGuardrailsSync(
            client,
            chunks(),
            [],
            [],
            [],
            suppressTripwire
          )) {
            yielded.push(response);
          }
          const finalChecks = !suppressTripwire || count % 100 !== 0 ? 1 : 0;
          expect(check).toHaveBeenCalledTimes(Math.floor(count / 100) + finalChecks);
          expect(yielded).toHaveLength(count + 2 + (suppressTripwire ? 0 : 1));
        });
      }
    }
  }

  for (const interval of [1, 100]) {
    it(`prioritizes execution failures over violations at interval ${interval}`, async () => {
      const error = Object.freeze(
        new GuardrailTripwireTriggered({ tripwireTriggered: false, info: {} })
      );
      const client = new OutputTestClient(
        () => ({
          tripwireTriggered: true,
          executionFailed: true,
          originalException: error,
          info: {},
        }),
        true
      );
      async function* chunks() {
        yield { type: 'response.output_text.delta', delta: 'Hello' };
      }
      const yielded: GuardrailsResponse[] = [];
      await expect(async () => {
        for await (const response of new StreamingMixin().streamWithGuardrails.call(
          client,
          chunks(),
          [],
          [],
          [],
          interval
        ))
          yielded.push(response);
      }).rejects.toBe(error);
      expect(yielded).toHaveLength(interval === 1 ? 0 : 1);
    });

    it(`still emits genuine violations before rejecting at interval ${interval}`, async () => {
      const result = { tripwireTriggered: true, info: {} };
      const client = new OutputTestClient(() => result, true);
      async function* chunks() {
        yield { type: 'response.output_text.delta', delta: 'Hello' };
      }
      const yielded: GuardrailsResponse[] = [];
      await expect(async () => {
        for await (const response of new StreamingMixin().streamWithGuardrails.call(
          client,
          chunks(),
          [],
          [],
          [],
          interval
        ))
          yielded.push(response);
      }).rejects.toBeInstanceOf(GuardrailTripwireTriggered);
      expect(yielded).toHaveLength(interval === 1 ? 1 : 2);
      expect(yielded.at(-1)?.guardrail_results.output).toEqual([result]);
    });
  }

  it('applies strict policy enabled after a non-strict checkpoint', async () => {
    const error = new Error('Inert check failure');
    const check = vi.fn(() => ({
      tripwireTriggered: false,
      executionFailed: true,
      originalException: error,
      info: {},
    }));
    const client = new OutputTestClient(check, false);
    async function* chunks() {
      yield { type: 'response.output_text.delta', delta: 'Hello' };
      client.raiseGuardrailErrors = true;
    }
    const iterator = new StreamingMixin().streamWithGuardrails.call(
      client,
      chunks(),
      [],
      [],
      [],
      1,
      true
    );
    expect((await iterator.next()).done).toBe(false);
    await expect(iterator.next()).rejects.toBe(error);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not mark a pending check strict when its result is accepted non-strictly', async () => {
    const error = new Error('Inert pending check failure');
    const result: GuardrailResult = {
      tripwireTriggered: false,
      executionFailed: true,
      originalException: error,
      info: {},
    };
    let finish!: (result: GuardrailResult) => void;
    const pending = new Promise<GuardrailResult>((resolve) => {
      finish = resolve;
    });
    let started!: () => void;
    const checkStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const check = vi
      .fn<() => GuardrailResult | Promise<GuardrailResult>>()
      .mockImplementationOnce(() => {
        started();
        return pending;
      })
      .mockReturnValue(result);
    const client = new OutputTestClient(check, true);
    async function* chunks() {
      yield { type: 'response.output_text.delta', delta: 'Hello' };
    }
    const iterator = new StreamingMixin().streamWithGuardrails.call(
      client,
      chunks(),
      [],
      [],
      [],
      1,
      true
    );
    const next = iterator.next();
    try {
      await checkStarted;
      client.raiseGuardrailErrors = false;
      finish(result);
      expect((await next).done).toBe(false);
      client.raiseGuardrailErrors = true;
      await expect(iterator.next()).rejects.toBe(error);
      expect(check).toHaveBeenCalledTimes(2);
    } finally {
      finish(result);
      await iterator.return(undefined);
    }
  });
});
