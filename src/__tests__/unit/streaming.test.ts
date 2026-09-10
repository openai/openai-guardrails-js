/**
 * Unit tests for the StreamingMixin utilities.
 *
 * These tests validate the periodic guardrail execution, tripwire handling,
 * and final flush behaviour for streaming responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingMixin } from '../../streaming';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { GuardrailsBaseClient, GuardrailResultsImpl, GuardrailsResponse } from '../../base-client';
import { GuardrailResult } from '../../types';

type MockClient = GuardrailsBaseClient & {
  extractResponseText: ReturnType<typeof vi.fn>;
  runStageGuardrails: ReturnType<typeof vi.fn>;
  createGuardrailsResponse: ReturnType<typeof vi.fn>;
};

const makeChunk = (text: string) => ({
  choices: [{ delta: { content: text } }],
});


async function collectAsyncIterator<T>(iterator: AsyncIterableIterator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of iterator) {
    results.push(value);
  }
  return results;
}

describe('StreamingMixin', () => {
  let client: MockClient;
  let mixin: StreamingMixin;

  beforeEach(() => {
    mixin = new StreamingMixin();

    client = {
      extractResponseText: vi.fn((chunk) => chunk.choices?.[0]?.delta?.content ?? ''),
      runStageGuardrails: vi.fn().mockResolvedValue([]),
      createGuardrailsResponse: vi.fn((chunk, pre, input, output) => ({
        chunk,
        guardrail_results: new GuardrailResultsImpl(pre, input, output),
      })),
    } as unknown as MockClient;
  });

  it('streams chunks and runs periodic guardrail checks', async () => {
    const chunks = [makeChunk('hi'), makeChunk(' there'), makeChunk('!')];
    async function* mockStream() {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    const iterator = mixin.streamWithGuardrails.call(
      client,
      mockStream(),
      [],
      [],
      [],
      /* checkInterval */ 2,
      false
    );

    const responses = await collectAsyncIterator(iterator);

    expect(responses).toHaveLength(4); // 3 chunks + final flush
    expect(client.extractResponseText).toHaveBeenCalledTimes(3);
    expect(client.runStageGuardrails).toHaveBeenCalledTimes(2); // once for periodic, once for final

    const periodicCall = client.runStageGuardrails.mock.calls[0];
    expect(periodicCall[0]).toBe('output');
    expect(periodicCall[1]).toBe('hi there');

    const finalResponse = responses[responses.length - 1] as GuardrailsResponse;
    expect(finalResponse.guardrail_results.output).toHaveLength(0);
  });

  it('yields final guardrail results from final flush', async () => {
    const chunks = [makeChunk('Guardrails')];
    client.runStageGuardrails.mockResolvedValue([{ tripwireTriggered: false } as GuardrailResult]);

    async function* mockStream() {
      yield* chunks;
    }

    const iterator = mixin.streamWithGuardrails.call(
      client,
      mockStream(),
      [],
      [],
      [],
      100,
      false
    );

    const responses = await collectAsyncIterator(iterator);
    expect(responses).toHaveLength(2);
    const finalResponse = responses[1] as GuardrailsResponse;
    expect(finalResponse.guardrail_results.output).toHaveLength(1);
  });

  it('propagates tripwire errors during periodic checks but yields final response', async () => {
    const tripwire = new GuardrailTripwireTriggered({
      tripwireTriggered: true,
      info: { guardrail_name: 'Test' },
    });

    client.runStageGuardrails.mockImplementationOnce(async () => {
      throw tripwire;
    });

    async function* mockStream() {
      yield makeChunk('tripwire');
    }

    const iterator = mixin.streamWithGuardrails.call(
      client,
      mockStream(),
      [],
      [],
      [],
      1,
      false
    );

    const results: GuardrailsResponse[] = [];
    await expect(async () => {
      for await (const value of iterator) {
        results.push(value);
      }
    }).rejects.toBe(tripwire);

    expect(results).toHaveLength(1);
    expect(results[0].guardrail_results.output).toHaveLength(1);
  });

  it('supports the synchronous wrapper helper', async () => {
    client.runStageGuardrails.mockResolvedValue([]);

    async function* mockStream() {
      yield makeChunk('sync');
    }

    const iterator = StreamingMixin.streamWithGuardrailsSync(
      client,
      mockStream(),
      [],
      [],
      []
    );

    const responses = await collectAsyncIterator(iterator);
    expect(responses).toHaveLength(2); // chunk + final flush
    expect(client.runStageGuardrails).toHaveBeenCalled();
  });
});

// Keep extraction and response wrapping real; only guardrail execution is spied on.
class StreamingTestClient extends GuardrailsBaseClient {
  protected createDefaultContext(): never {
    throw new Error('No network context is needed for these fixtures');
  }

  protected overrideResources(): void {}
}

const makeResponseDelta = (
  delta: string
): import('openai').OpenAI.Responses.ResponseTextDeltaEvent => ({
  type: 'response.output_text.delta',
  delta,
  item_id: 'message_1',
  output_index: 0,
  content_index: 0,
  sequence_number: 1,
});

async function* streamEvents(events: unknown[]) {
  yield* events;
}

describe('Responses streaming with the real text extractor', () => {
  it.each(['async', 'sync'] as const)(
    'checks final text once through the %s helper',
    async (helper) => {
      const client = new StreamingTestClient();
      const result: GuardrailResult = { tripwireTriggered: false, info: {} };
      const stage = vi.spyOn(client, 'runStageGuardrails').mockResolvedValue([result]);
      const history = [{ role: 'user', content: 'Say hello' }];
      const events = [
        { type: 'response.created', response: { output: [] } },
        makeResponseDelta('Hello'),
        { type: 'response.function_call_arguments.delta', delta: 'tool arguments' },
        { type: 'response.reasoning_summary_text.delta', delta: 'reasoning' },
        makeResponseDelta(' world'),
        { type: 'response.output_text.done', text: 'Hello world' },
        { type: 'response.completed', response: { output: [], output_text: 'Hello world' } },
      ];
      const iterator =
        helper === 'sync'
          ? StreamingMixin.streamWithGuardrailsSync(client, streamEvents(events), [], [], history)
          : new StreamingMixin().streamWithGuardrails.call(
              client,
              streamEvents(events),
              [],
              [],
              history
            );
      const responses = await collectAsyncIterator(iterator);

      expect(stage).toHaveBeenCalledExactlyOnceWith(
        'output',
        'Hello world',
        [...history, { role: 'assistant', content: 'Hello world' }],
        false
      );
      expect(responses).toHaveLength(events.length + 1);
      for (const [index, event] of events.entries()) {
        expect(responses[index]).toMatchObject(event);
      }
      expect(responses.at(-1)).toMatchObject({ type: 'final', accumulated_text: 'Hello world' });
      expect(responses.at(-1)?.guardrail_results.output).toEqual([result]);
      expect(history).toEqual([{ role: 'user', content: 'Say hello' }]);
    }
  );

  it.each([false, true])(
    'runs periodic checks with suppressTripwire=%s',
    async (suppressTripwire) => {
      const client = new StreamingTestClient();
      const stage = vi.spyOn(client, 'runStageGuardrails').mockResolvedValue([]);
      const events = [
        makeResponseDelta('Hello'),
        makeResponseDelta(''),
        makeResponseDelta(' world'),
      ];
      await collectAsyncIterator(
        new StreamingMixin().streamWithGuardrails.call(
          client,
          streamEvents(events),
          [],
          [],
          [],
          2,
          suppressTripwire
        )
      );
      expect(stage).toHaveBeenNthCalledWith(
        1,
        'output',
        'Hello world',
        [{ role: 'assistant', content: 'Hello world' }],
        suppressTripwire
      );
    }
  );

  it.each([1, 100])('reports and throws an output tripwire at interval %s', async (interval) => {
    const client = new StreamingTestClient();
    const tripwire = new GuardrailTripwireTriggered({ tripwireTriggered: true, info: {} });
    const stage = vi.spyOn(client, 'runStageGuardrails').mockRejectedValue(tripwire);
    const received: GuardrailsResponse[] = [];
    const iterator = new StreamingMixin().streamWithGuardrails.call(
      client,
      streamEvents([makeResponseDelta('ordinary fixture')]),
      [],
      [],
      [],
      interval
    );
    await expect(async () => {
      for await (const response of iterator) received.push(response);
    }).rejects.toBe(tripwire);
    expect(stage).toHaveBeenCalledWith(
      'output',
      'ordinary fixture',
      [{ role: 'assistant', content: 'ordinary fixture' }],
      false
    );
    expect(received.at(-1)?.guardrail_results.output).toEqual([tripwire.guardrailResult]);
  });

  it('preserves Chat delta extraction', async () => {
    const client = new StreamingTestClient();
    const stage = vi.spyOn(client, 'runStageGuardrails').mockResolvedValue([]);
    await collectAsyncIterator(
      StreamingMixin.streamWithGuardrailsSync(
        client,
        streamEvents([makeChunk('Hello'), makeChunk(' world')]),
        [],
        []
      )
    );
    expect(stage).toHaveBeenCalledExactlyOnceWith(
      'output',
      'Hello world',
      [{ role: 'assistant', content: 'Hello world' }],
      false
    );
  });

  it('does not treat non-text events or empty deltas as output text', async () => {
    const client = new StreamingTestClient();
    const stage = vi.spyOn(client, 'runStageGuardrails').mockResolvedValue([]);
    const events = [
      makeResponseDelta(''),
      { type: 'response.function_call_arguments.delta', delta: 'arguments' },
      { type: 'response.output_text.delta', delta: null },
      { type: 'response.output_text.delta' },
    ];
    const responses = await collectAsyncIterator(
      StreamingMixin.streamWithGuardrailsSync(client, streamEvents(events), [], [])
    );
    expect(stage).not.toHaveBeenCalled();
    expect(responses).toHaveLength(events.length);
  });
});
