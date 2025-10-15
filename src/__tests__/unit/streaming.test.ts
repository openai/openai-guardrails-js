/**
 * Unit tests for the StreamingMixin utilities.
 *
 * These tests validate the periodic guardrail execution, tripwire handling,
 * and final flush behaviour for streaming responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamingMixin } from '../../streaming';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { GuardrailsBaseClient, GuardrailResultsImpl } from '../../base-client';
import { GuardrailResult } from '../../types';

type MockClient = GuardrailsBaseClient & {
  extractResponseText: ReturnType<typeof vi.fn>;
  runStageGuardrails: ReturnType<typeof vi.fn>;
  createGuardrailsResponse: ReturnType<typeof vi.fn>;
};

const makeChunk = (text: string) => ({
  choices: [{ delta: { content: text } }],
});

const guardrailResults = (output: GuardrailResult[] = []) =>
  new GuardrailResultsImpl([], [], output);

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

    const finalResponse = responses[responses.length - 1];
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
    const finalResponse = responses[1];
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

    const results: any[] = [];
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
