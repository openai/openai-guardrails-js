/** Inert, mocked-provider regressions for validation of Chat alternatives. */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAI } from 'openai';
import { GuardrailsBaseClient, GuardrailsResponse, OpenAIResponseType } from '../../base-client';
import { GuardrailLLMContext, GuardrailLLMContextWithHistory, GuardrailResult } from '../../types';
import { StreamingMixin } from '../../streaming';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { GuardrailSpec } from '../../spec';

class ChoiceClient extends GuardrailsBaseClient {
  readonly check = vi.fn((context: GuardrailLLMContext, text: string): GuardrailResult => ({
    tripwireTriggered: text === 'second choice',
    info: { text, history: (context as GuardrailLLMContextWithHistory).getConversationHistory?.() },
  }));

  constructor() {
    super();
    this.context = this.createDefaultContext();
    this.guardrails = {
      pre_flight: [], input: [], output: [new GuardrailSpec(
        'Inert check', 'Choice fixture', 'text/plain', z.object({}),
        (context, text) => this.check(context as GuardrailLLMContext, text),
        z.object({}), { usesConversationHistory: true }
      ).instantiate({})],
    };
  }

  protected createDefaultContext(): GuardrailLLMContext {
    return { guardrailLlm: new OpenAI({ apiKey: 'test' }) };
  }

  protected overrideResources(): void { /* No transport needed for shared-handler tests. */ }

  handle(response: OpenAIResponseType, suppressTripwire = false) {
    return this.handleLlmResponse(response, [], [], [{ role: 'user', content: 'question' }], suppressTripwire);
  }
}

const completion = (contents: Array<string | null>) => ({
  id: 'fixture', object: 'chat.completion', created: 0, model: 'fixture',
  choices: contents.map((content, index) => ({
    index, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null,
  })),
} as OpenAI.Chat.Completions.ChatCompletion);

const chunk = (parts: Array<[number, string | null]>) => ({
  id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture',
  choices: parts.map(([index, content]) => ({ index, delta: { content }, finish_reason: null, logprobs: null })),
} as OpenAI.Chat.Completions.ChatCompletionChunk);

async function* stream(chunks: OpenAI.Chat.Completions.ChatCompletionChunk[]) { yield* chunks; }
async function collect(iterator: AsyncIterableIterator<GuardrailsResponse>) {
  const results: GuardrailsResponse[] = [];
  for await (const response of iterator) { results.push(response); }
  return results;
}

describe('Chat choice validation', () => {
  it('applies the tripwire to a later choice', async () => {
    const client = new ChoiceClient();
    await expect(client.handle(completion(['first choice', 'second choice']))).rejects.toBeInstanceOf(GuardrailTripwireTriggered);
    expect(client.check.mock.calls.map(([, text]) => text)).toEqual(['first choice', 'second choice']);
  });

  it('keeps alternatives and their conversation contexts separate in suppressed mode', async () => {
    const client = new ChoiceClient();
    const original = completion(['first choice', 'second choice', 'third choice']);
    const response = await client.handle(original, true);
    expect(response).toHaveProperty('choices', original.choices);
    expect(response.guardrail_results.output.map((result) => result.tripwireTriggered)).toEqual([false, true, false]);
    for (const [context, text] of client.check.mock.calls) {
      expect((context as GuardrailLLMContextWithHistory).getConversationHistory?.()).toEqual([
        { role: 'user', content: 'question' }, { role: 'assistant', content: text },
      ]);
    }
  });

  it('preserves single-choice and textless response handling', async () => {
    const client = new ChoiceClient();
    const response = await client.handle(completion(['first choice']));
    expect(response.guardrail_results.output).toHaveLength(1);
    await client.handle(completion([null, 'third choice']));
    await expect(client.handle(completion([]))).resolves.toHaveProperty('choices', []);
    expect(client.check.mock.calls.map(([, text]) => text)).toEqual(['first choice', '', 'third choice', '']);
  });

  it.each([false, true])('tracks reordered, interleaved streamed choices independently (suppressed=%s)', async (suppressed) => {
    const client = new ChoiceClient();
    client.check.mockImplementation((context, text) => ({ tripwireTriggered: false, info: { text, history: (context as GuardrailLLMContextWithHistory).getConversationHistory?.() } }));
    const chunks = [chunk([[1, 'other'], [0, 'first']]), chunk([[0, ' choice']]), chunk([[1, ' answer']]), chunk([]), chunk([[0, null]])];
    const responses = await collect(StreamingMixin.prototype.streamWithGuardrails.call(client, stream(chunks), [], [], [{ role: 'user', content: 'question' }], 2, suppressed));
    expect(client.check.mock.calls.map(([, text]) => text)).toEqual(['first choice', 'other answer', 'other answer', 'first choice']);
    for (const [context, text] of client.check.mock.calls) {
      expect((context as GuardrailLLMContextWithHistory).getConversationHistory?.()).toEqual([{ role: 'user', content: 'question' }, { role: 'assistant', content: text }]);
    }
    responses.slice(0, chunks.length).forEach((response, index) => {
      expect(response).toHaveProperty('choices', chunks[index].choices);
    });
    expect(responses.at(-1)).toMatchObject({ type: 'final', accumulated_text: 'first choice' });
    expect(responses.at(-1)?.guardrail_results.output).toHaveLength(2);
  });

  it.each([1, 100])('triggers on a later streamed choice at interval %s', async (interval) => {
    const client = new ChoiceClient();
    const iterator = StreamingMixin.prototype.streamWithGuardrails.call(client, stream([chunk([[0, 'first choice'], [1, 'second choice']])]), [], [], [], interval, false);
    await expect(collect(iterator)).rejects.toBeInstanceOf(GuardrailTripwireTriggered);
    expect(client.check.mock.calls.map(([, text]) => text)).toEqual(['first choice', 'second choice']);
  });

  it('returns final results for every choice in a short suppressed stream', async () => {
    const client = new ChoiceClient();
    const responses = await collect(StreamingMixin.streamWithGuardrailsSync(client, stream([chunk([[0, 'first choice'], [1, 'second choice']])]), [], [], [], true));
    expect(responses.at(-1)?.guardrail_results.output.map((result) => result.tripwireTriggered)).toEqual([false, true]);
  });

  it('handles a textless first choice and usage-only chunks', async () => {
    const client = new ChoiceClient();
    const responses = await collect(StreamingMixin.streamWithGuardrailsSync(client, stream([chunk([[0, null], [1, 'second choice']]), chunk([])]), [], [], [], true));
    expect(client.check.mock.calls.map(([, text]) => text)).toEqual(['second choice']);
    expect(responses.at(-1)?.guardrail_results.tripwiresTriggered).toBe(true);
  });
});
