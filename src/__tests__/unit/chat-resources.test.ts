/**
 * Unit tests for the chat and responses resource adapters.
 *
 * These ensure guardrail stages execute in the correct order and that
 * streaming vs non-streaming behaviour delegates appropriately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const streamSyncMock = vi.fn();

vi.mock('../../streaming', () => ({
  StreamingMixin: {
    streamWithGuardrailsSync: streamSyncMock,
  },
}));

vi.mock('../../streaming.js', () => ({
  StreamingMixin: {
    streamWithGuardrailsSync: streamSyncMock,
  },
}));

const baseClientMock = () => {
  const normalizedMessages = [{ role: 'user', content: 'normalized' }];
  const normalizedString = [{ role: 'user', content: 'Tell me something' }];

  return {
    extractLatestUserTextMessage: vi.fn().mockReturnValue(['latest user', 1]),
    runStageGuardrails: vi.fn(),
    applyPreflightModifications: vi.fn((payload) => payload),
    handleLlmResponse: vi.fn().mockResolvedValue({ result: 'handled' }),
    raiseGuardrailErrors: false,
    _resourceClient: {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({ id: 'chat-response' }),
        },
      },
      responses: {
        create: vi.fn().mockResolvedValue({ id: 'responses-api' }),
      },
    },
    normalizeConversationHistory: vi
      .fn()
      .mockImplementation((payload) =>
        typeof payload === 'string' ? normalizedString : normalizedMessages
      ),
    loadConversationHistoryFromPreviousResponse: vi.fn().mockResolvedValue([]),
  };
};

describe('Chat resource', () => {
  let client: ReturnType<typeof baseClientMock>;

  beforeEach(() => {
    client = baseClientMock();
    client.runStageGuardrails
      .mockResolvedValueOnce([{ stage: 'preflight' }])
      .mockResolvedValueOnce([{ stage: 'input' }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs guardrail stages and delegates non-streaming responses to handler', async () => {
    const { Chat } = await import('../../resources/chat/chat');
    const chat = new Chat(client as unknown as ConstructorParameters<typeof Chat>[0]);
    const messages = [{ role: 'user', content: 'hello' }];

    const result = await chat.completions.create({
      messages,
      model: 'gpt-4',
    });

    expect(client.extractLatestUserTextMessage).toHaveBeenCalledWith(messages);
    expect(client.runStageGuardrails).toHaveBeenNthCalledWith(
      1,
      'pre_flight',
      'latest user',
      client.normalizeConversationHistory.mock.results[0].value,
      false,
      false
    );
    expect(client.runStageGuardrails).toHaveBeenNthCalledWith(
      2,
      'input',
      'latest user',
      client.normalizeConversationHistory.mock.results[0].value,
      false,
      false
    );
    expect(client._resourceClient.chat.completions.create).toHaveBeenCalledWith({
      messages,
      model: 'gpt-4',
      stream: false,
      safety_identifier: 'oai-guardrails-ts',
    });
    expect(client.handleLlmResponse).toHaveBeenCalledWith(
      { id: 'chat-response' },
      [{ stage: 'preflight' }],
      [{ stage: 'input' }],
      client.normalizeConversationHistory.mock.results[0].value,
      false
    );
    expect(result).toEqual({ result: 'handled' });
  });

});

describe('Responses resource', () => {
  let client: ReturnType<typeof baseClientMock>;

  beforeEach(() => {
    client = baseClientMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('handles non-streaming response calls', async () => {
    const { Responses } = await import('../../resources/responses/responses');
    client.runStageGuardrails
      .mockResolvedValueOnce([{ stage: 'preflight' }])
      .mockResolvedValueOnce([{ stage: 'input' }]);

    const responses = new Responses(client as unknown as ConstructorParameters<typeof Responses>[0]);

    const payload = await responses.create({
      input: 'Tell me something',
      model: 'gpt-4o',
    });

    expect(client.loadConversationHistoryFromPreviousResponse).toHaveBeenCalledWith(undefined);
    expect(client.extractLatestUserTextMessage).not.toHaveBeenCalled(); // string input path
    expect(client.runStageGuardrails).toHaveBeenNthCalledWith(
      1,
      'pre_flight',
      'Tell me something',
      client.normalizeConversationHistory.mock.results[0].value,
      false,
      false
    );
    expect(client.runStageGuardrails).toHaveBeenNthCalledWith(
      2,
      'input',
      'Tell me something',
      client.normalizeConversationHistory.mock.results[0].value,
      false,
      false
    );
    expect(client._resourceClient.responses.create).toHaveBeenCalledWith({
      input: 'Tell me something',
      model: 'gpt-4o',
      stream: false,
      tools: undefined,
      safety_identifier: 'oai-guardrails-ts',
    });
    expect(client.handleLlmResponse).toHaveBeenCalledWith(
      { id: 'responses-api' },
      [{ stage: 'preflight' }],
      [{ stage: 'input' }],
      client.normalizeConversationHistory.mock.results[0].value,
      false
    );
    expect(payload).toEqual({ result: 'handled' });
  });

});
