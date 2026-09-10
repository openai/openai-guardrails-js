import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse } from '../../base-client';
import { GuardrailRegistry } from '../../registry';
import { GuardrailLLMContext, GuardrailResult } from '../../types';
import { Chat } from '../../resources/chat';
import { Responses } from '../../resources/responses';
import { StreamingMixin } from '../../streaming';

class OutputTestClient extends GuardrailsBaseClient {
  constructor(check: () => GuardrailResult, strict: boolean | undefined) {
    super();
    const registry = new GuardrailRegistry();
    registry.register('Output fixture', vi.fn(check), 'Inert output check');
    this.guardrails = {
      pre_flight: [],
      input: [],
      output: [registry.get('Output fixture')!.instantiate({})],
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

  for (const failureKind of ['throw', 'result'] as const) {
    for (const strict of [true, false, undefined]) {
      describe(`${failureKind}, strict=${strict}`, () => {
        const setup = () => {
          vi.spyOn(console, 'error').mockImplementation(() => undefined);
          const error = new Error('Inert check unavailable');
          const client = new OutputTestClient(() => {
            if (failureKind === 'throw') throw error;
            return {
              tripwireTriggered: false,
              executionFailed: true,
              originalException: error,
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
                await expect(response).rejects.toBe(error);
              } else {
                expect((await response).guardrail_results.output[0]).toMatchObject({
                  executionFailed: true,
                  originalException: error,
                });
              }
            });
          }
        }

        for (const [checkpoint, interval, suppressTripwire] of [
          ['periodic', 1, false],
          ['periodic suppressed', 1, true],
          ['final', 100, false],
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
              await expect(consume()).rejects.toBe(error);
              // A final check can fail after chunks were streamed, but emits no successful final result.
              expect(yielded).toHaveLength(interval === 1 ? 0 : 1);
            } else {
              await consume();
              expect(yielded).toHaveLength(suppressTripwire ? 1 : 2);
              if (!suppressTripwire) {
                expect(yielded[1].guardrail_results.output[0]).toMatchObject({
                  executionFailed: true,
                  originalException: error,
                });
              }
            }
          });
        }
      });
    }
  }
});
