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
import { GuardrailLLMContext, GuardrailResult, TextInput, Message, TextOnlyMessageArray } from '../../types';

// Removed unused interface

interface MockPipeline {
  stages: string[];
  config: Record<string, unknown>;
}

// Interface for response with guardrail results
interface ResponseWithGuardrailResults {
  guardrail_results: {
    output: GuardrailResult[];
  };
}

class TestGuardrailsClient extends GuardrailsBaseClient {
  public setContext(ctx: GuardrailLLMContext): void {
    (this as unknown as { context: GuardrailLLMContext }).context = ctx;
  }

  public setGuardrails(guardrails: StageGuardrails): void {
    (this as unknown as { guardrails: StageGuardrails }).guardrails = guardrails;
  }

  public setPipeline(pipeline: MockPipeline): void {
    (this as unknown as { pipeline: MockPipeline }).pipeline = pipeline;
  }

  protected createDefaultContext(): GuardrailLLMContext {
    return { guardrailLlm: {} as unknown as import('openai').OpenAI };
  }

  protected overrideResources(): void {
    // Not needed for unit tests
  }
}

const createGuardrail = (
  name: string,
  implementation: (ctx: GuardrailLLMContext, text: TextInput) => GuardrailResult | Promise<GuardrailResult>,
  metadata?: Record<string, unknown>
): unknown => ({
  definition: { 
    name,
    mediaType: 'text/plain', // Ensure test guardrails have proper media type
    metadata: metadata || {}
  },
  config: {},
  run: vi.fn(implementation),
  ensureAsync: vi.fn(),
});

describe('GuardrailsBaseClient helpers', () => {
  let client: TestGuardrailsClient;

  beforeEach(() => {
    client = new TestGuardrailsClient();
    client.setContext({ guardrailLlm: {} as unknown as import('openai').OpenAI });
    client.setGuardrails({
      pre_flight: [],
      input: [],
      output: [],
    });
  });

  describe('extractLatestUserTextMessage', () => {
    it('returns the latest user message and index for string content', () => {
      const messages: Message[] = [
        { role: 'system', content: 'hi' },
        { role: 'user', content: ' first ' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: ' second ' },
      ];

      const [text, index] = client.extractLatestUserTextMessage(messages);

      expect(text).toBe('second');
      expect(index).toBe(3);
    });

    it('handles responses API content parts', () => {
      const messages: Message[] = [
        { role: 'user', content: [{ type: 'text' as const, text: 'hello' }] },
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'part1' },
            { type: 'text' as const, text: 'part2' },
          ],
        },
      ];

      const [text, index] = client.extractLatestUserTextMessage(messages);

      expect(text).toBe('part1 part2');
      expect(index).toBe(1);
    });

    it('returns empty string when no user messages exist', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'hi' },
      ];
      const [text, index] = client.extractLatestUserTextMessage(messages);
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
            checked_text: 'Reach me at alice@example.com',
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
      const messages: Message[] = [
        { role: 'assistant', content: 'hello' },
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'Call me at 123-456-7890' },
            { type: 'text' as const, text: 'or email alice@example.com' },
          ],
        },
      ];

      const results: GuardrailResult[] = [
        {
          tripwireTriggered: false,
          info: {
            checked_text: 'Call me at 123-456-7890 or email alice@example.com',
            detected_entities: {
              PHONE: ['123-456-7890'],
              EMAIL: ['alice@example.com'],
            },
          },
        },
      ];

      const masked = client.applyPreflightModifications(messages, results) as Message[];
      const [, latestMessage] = masked;

      expect((latestMessage.content as { type: string; text: string }[])[0].text).toBe('Call me at <PHONE>');
      expect((latestMessage.content as { type: string; text: string }[])[1].text).toBe('or email <EMAIL>');
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
        pre_flight: [createGuardrail('Test Guard', async () => ({ ...baseResult })) as unknown as Parameters<typeof client.setGuardrails>[0]['pre_flight'][0]],
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
          })) as unknown as Parameters<typeof client.setGuardrails>[0]['pre_flight'][0],
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
          })) as unknown as Parameters<typeof client.setGuardrails>[0]['pre_flight'][0],
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
          }) as unknown as Parameters<typeof client.setGuardrails>[0]['pre_flight'][0],
        ],
        input: [],
        output: [],
      });

      await expect(
        client.runStageGuardrails('pre_flight', 'payload', undefined, false, true)
      ).rejects.toThrow('boom');
    });

    it('creates a conversation-aware context for prompt injection detection guardrails', async () => {
      const guardrail = createGuardrail(
        'Prompt Injection Detection',
        async () => ({
          tripwireTriggered: false,
          info: { observation: 'ok' },
        }),
        { usesConversationHistory: true }
      );
      client.setGuardrails({
        pre_flight: [guardrail as unknown as Parameters<typeof client.setGuardrails>[0]['pre_flight'][0]],
        input: [],
        output: [],
      });
      const spy = vi.spyOn(client as unknown as { createContextWithConversation: () => GuardrailLLMContext }, 'createContextWithConversation');

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
      const conversation: TextOnlyMessageArray = [{ role: 'user', content: 'hi' }];
      const outputResult: GuardrailResult = { tripwireTriggered: false, info: { message: 'All good' } };
      interface MockLLMResponse {
        choices: Array<{
          message: {
            role: string;
            content: string;
          };
        }>;
      }

      const runSpy = vi
        .spyOn(client as unknown as { runStageGuardrails: () => Promise<GuardrailResult[]> }, 'runStageGuardrails')
        .mockResolvedValue([outputResult]);

      const llmResponse: MockLLMResponse = {
        choices: [{ message: { role: 'assistant', content: 'All good' } }],
      };

      const response = await (client as unknown as { handleLlmResponse: (llmResponse: unknown, inputResults: GuardrailResult[], outputResults: GuardrailResult[], conversation: TextOnlyMessageArray) => Promise<unknown> }).handleLlmResponse(
        llmResponse as unknown,
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
      expect((response as unknown as ResponseWithGuardrailResults).guardrail_results).toBeInstanceOf(GuardrailResultsImpl);
      expect((response as unknown as ResponseWithGuardrailResults).guardrail_results.output).toEqual([outputResult]);
    });
  });
});
