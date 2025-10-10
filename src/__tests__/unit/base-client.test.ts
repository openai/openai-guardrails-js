/**
 * Unit tests for GuardrailsBaseClient shared helpers.
 *
 * These tests focus on the guardrail orchestration helpers that organize
 * contexts, apply PII masking, and coordinate guardrail execution for the
 * higher-level clients.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuardrailsBaseClient, GuardrailResultsImpl, StageGuardrails } from '../../base-client';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { GuardrailLLMContext, GuardrailResult } from '../../types';

interface MockGuardrail {
  definition: {
    name: string;
    metadata?: Record<string, unknown>;
  };
  run: ReturnType<typeof vi.fn>;
}

class TestGuardrailsClient extends GuardrailsBaseClient {
  public setContext(ctx: GuardrailLLMContext): void {
    (this as any).context = ctx;
  }

  public setGuardrails(guardrails: StageGuardrails): void {
    (this as any).guardrails = guardrails;
  }

  public setPipeline(pipeline: any): void {
    (this as any).pipeline = pipeline;
  }

  protected createDefaultContext(): GuardrailLLMContext {
    return { guardrailLlm: {} as any };
  }

  protected overrideResources(): void {
    // Not needed for unit tests
  }
}

const createGuardrail = (
  name: string,
  implementation: (ctx: any, text: string) => GuardrailResult | Promise<GuardrailResult>
): MockGuardrail => ({
  definition: { name },
  run: vi.fn(implementation),
});

describe('GuardrailsBaseClient helpers', () => {
  let client: TestGuardrailsClient;

  beforeEach(() => {
    client = new TestGuardrailsClient();
    client.setContext({ guardrailLlm: {} } as GuardrailLLMContext);
    client.setGuardrails({
      pre_flight: [],
      input: [],
      output: [],
    });
  });

  describe('extractLatestUserMessage', () => {
    it('returns the latest user message and index for string content', () => {
      const messages = [
        { role: 'system', content: 'hi' },
        { role: 'user', content: ' first ' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: ' second ' },
      ];

      const [text, index] = client.extractLatestUserMessage(messages);

      expect(text).toBe('second');
      expect(index).toBe(3);
    });

    it('handles responses API content parts', () => {
      const messages = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'part1' },
            { type: 'text', text: 'part2' },
          ],
        },
      ];

      const [text, index] = client.extractLatestUserMessage(messages);

      expect(text).toBe('part1 part2');
      expect(index).toBe(1);
    });

    it('returns empty string when no user messages exist', () => {
      const [text, index] = client.extractLatestUserMessage([
        { role: 'assistant', content: 'hi' },
      ]);
      expect(text).toBe('');
      expect(index).toBe(-1);
    });
  });

  describe('applyPreflightModifications', () => {
    it('masks detected PII in string inputs', () => {
      const results: GuardrailResult[] = [
        {
          tripwireTriggered: false,
          info: {
            detected_entities: {
              EMAIL: ['alice@example.com'],
            },
          },
        },
      ];

      const masked = client.applyPreflightModifications(
        'Reach me at alice@example.com',
        results
      ) as string;

      expect(masked).toBe('Reach me at <EMAIL>');
    });

    it('masks detected PII in the latest user message with structured content', () => {
      const messages = [
        { role: 'assistant', content: 'hello' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Call me at 123-456-7890' },
            { type: 'text', text: 'or email alice@example.com' },
          ],
        },
      ];

      const results: GuardrailResult[] = [
        {
          tripwireTriggered: false,
          info: {
            detected_entities: {
              PHONE: ['123-456-7890'],
              EMAIL: ['alice@example.com'],
            },
          },
        },
      ];

      const masked = client.applyPreflightModifications(messages, results) as any[];
      const [, latestMessage] = masked;

      expect(latestMessage.content[0].text).toBe('Call me at <PHONE>');
      expect(latestMessage.content[1].text).toBe('or email <EMAIL>');
      // Ensure assistant message unchanged
      expect(masked[0]).toEqual(messages[0]);
    });

    it('returns original payload when no detected entities exist', () => {
      const data = 'Nothing to mask';
      const result = client.applyPreflightModifications(data, []);
      expect(result).toBe(data);
    });
  });

  describe('runStageGuardrails', () => {
    const baseResult = {
      tripwireTriggered: false,
      info: {},
    };

    beforeEach(() => {
      client.setGuardrails({
        pre_flight: [createGuardrail('Test Guard', async () => ({ ...baseResult }))],
        input: [],
        output: [],
      });
    });

    it('executes guardrails and annotates info metadata', async () => {
      const results = await client.runStageGuardrails('pre_flight', 'payload');

      expect(results).toHaveLength(1);
      expect(results[0].info).toMatchObject({
        stage_name: 'pre_flight',
        guardrail_name: 'Test Guard',
      });
    });

    it('throws GuardrailTripwireTriggered when guardrail reports tripwire', async () => {
      client.setGuardrails({
        pre_flight: [
          createGuardrail('Tripwire', async () => ({
            tripwireTriggered: true,
            info: { reason: 'bad' },
          })),
        ],
        input: [],
        output: [],
      });

      await expect(client.runStageGuardrails('pre_flight', 'payload')).rejects.toBeInstanceOf(
        GuardrailTripwireTriggered
      );
    });

    it('suppresses tripwire errors when suppressTripwire=true', async () => {
      client.setGuardrails({
        pre_flight: [
          createGuardrail('Tripwire', async () => ({
            tripwireTriggered: true,
            info: { reason: 'bad' },
          })),
        ],
        input: [],
        output: [],
      });

      const results = await client.runStageGuardrails('pre_flight', 'payload', undefined, true);
      expect(results).toHaveLength(1);
      expect(results[0].tripwireTriggered).toBe(true);
    });

    it('rethrows execution errors when raiseGuardrailErrors=true', async () => {
      client.setGuardrails({
        pre_flight: [
          createGuardrail('Faulty', async () => {
            throw new Error('boom');
          }),
        ],
        input: [],
        output: [],
      });

      await expect(
        client.runStageGuardrails('pre_flight', 'payload', undefined, false, true)
      ).rejects.toThrow('boom');
    });

    it('creates a conversation-aware context for prompt injection detection guardrails', async () => {
      const guardrail = createGuardrail('Prompt Injection Detection', async () => ({
        tripwireTriggered: false,
        info: {},
      }));
      client.setGuardrails({
        pre_flight: [guardrail],
        input: [],
        output: [],
      });
      const spy = vi.spyOn(client as any, 'createContextWithConversation');

      await client.runStageGuardrails(
        'pre_flight',
        'payload',
        [{ role: 'user', content: 'hi' }],
        false,
        false
      );

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('handleLlmResponse', () => {
    it('appends LLM response to conversation history and returns guardrail results', async () => {
      const conversation = [{ role: 'user', content: 'hi' }];
      const outputResult = { tripwireTriggered: false, info: {} };
      const runSpy = vi
        .spyOn(client as any, 'runStageGuardrails')
        .mockResolvedValue([outputResult]);

      const llmResponse: any = {
        choices: [{ message: { role: 'assistant', content: 'All good' } }],
      };

      const response = await (client as any).handleLlmResponse(
        llmResponse,
        [],
        [],
        conversation
      );

      expect(runSpy).toHaveBeenCalledWith(
        'output',
        'All good',
        expect.arrayContaining([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'All good' },
        ]),
        false
      );
      expect(response.guardrail_results).toBeInstanceOf(GuardrailResultsImpl);
      expect(response.guardrail_results.output).toEqual([outputResult]);
    });
  });
});
