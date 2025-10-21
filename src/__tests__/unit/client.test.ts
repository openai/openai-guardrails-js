/**
 * Tests for GuardrailsOpenAI and GuardrailsAzureOpenAI wrappers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock interfaces for better type safety
interface MockOpenAIOptions {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  timeout?: number;
  maxRetries?: number;
}

interface MockGuardrailsClient {
  raiseGuardrailErrors: boolean;
  _resourceClient: MockOpenAI;
  context: {
    guardrailLlm: MockOpenAI;
  };
}

// Interface for accessing private properties in tests
interface TestGuardrailsOpenAI {
  guardrailsClient: MockGuardrailsClient;
  overrideResources(): void;
  guardrails: {
    chat: { client: MockGuardrailsClient };
    responses: { client: MockGuardrailsClient };
  };
}

// Interface for accessing private chat client property
interface TestChat {
  client: MockGuardrailsClient;
}

const openAiInstances: MockOpenAI[] = [];

class MockOpenAI {
  public chat = { completions: { create: vi.fn() } };
  public responses = { create: vi.fn() };

  constructor(public options: MockOpenAIOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
    this.organization = options.organization;
    this.timeout = options.timeout;
    this.maxRetries = options.maxRetries;
    openAiInstances.push(this);
  }

  public apiKey?: string;
  public baseURL?: string;
  public organization?: string;
  public timeout?: number;
  public maxRetries?: number;
}

class MockAzureOpenAI extends MockOpenAI {}

vi.mock('openai', () => ({
  OpenAI: MockOpenAI,
  AzureOpenAI: MockAzureOpenAI,
}));

vi.mock('../../runtime', () => ({
  loadPipelineBundles: vi.fn(async (config) => config),
  instantiateGuardrails: vi.fn(async () => []),
}));

class MockChat {
  constructor(public client: MockGuardrailsClient) {}
}
class MockResponses {
  constructor(public client: MockGuardrailsClient) {}
}

describe('Guardrails clients', () => {
  beforeEach(() => {
    openAiInstances.length = 0;
    vi.resetModules();
  });

  it('GuardrailsOpenAI.create wires guardrails client and clones resource client', async () => {
    const { GuardrailsOpenAI } = await import('../../client');

    const overrideSpy = vi
      .spyOn(GuardrailsOpenAI.prototype as unknown as TestGuardrailsOpenAI, 'overrideResources')
      .mockImplementation(function () {
        const client = this.guardrailsClient;
        Object.defineProperty(this, 'chat', {
          value: new MockChat(client),
          configurable: true,
        });
        Object.defineProperty(this, 'responses', {
          value: new MockResponses(client),
          configurable: true,
        });
        Object.defineProperty(this, 'guardrails', {
          value: {
            chat: new MockChat(client),
            responses: new MockResponses(client),
          },
          configurable: true,
        });
      });

    const instance = await GuardrailsOpenAI.create({ input: { guardrails: [] } }, { apiKey: 'key-123', timeout: 5000 }, true);

    const guardrailsClient = (instance as unknown as TestGuardrailsOpenAI).guardrailsClient ?? (instance.guardrails.chat as unknown as TestChat).client as MockGuardrailsClient;
    expect(guardrailsClient.raiseGuardrailErrors).toBe(true);

    const resourceClient = guardrailsClient._resourceClient;
    expect(resourceClient).toBeInstanceOf(MockOpenAI);
    expect(resourceClient.apiKey).toBe('key-123');
    expect(resourceClient.timeout).toBe(5000);

    const guardrailCtx = guardrailsClient.context.guardrailLlm;
    expect(guardrailCtx).toBeInstanceOf(MockOpenAI);
    expect(guardrailCtx).not.toBe(resourceClient);
    expect(guardrailCtx.apiKey).toBe('key-123');

    expect(instance.guardrails.chat).toBeInstanceOf(MockChat);
    expect(instance.guardrails.responses).toBeInstanceOf(MockResponses);
    expect((instance.guardrails.chat as unknown as TestChat).client).toBe(guardrailsClient);
    expect(instance.chat).toBeInstanceOf(MockChat);

    overrideSpy.mockRestore();
  });

  it('GuardrailsAzureOpenAI.create uses Azure client for context', async () => {
    const { GuardrailsAzureOpenAI } = await import('../../client');

    const overrideSpy = vi
      .spyOn(GuardrailsAzureOpenAI.prototype as unknown as TestGuardrailsOpenAI, 'overrideResources')
      .mockImplementation(function () {
        const client = this.guardrailsClient;
        Object.defineProperty(this, 'chat', {
          value: new MockChat(client),
          configurable: true,
        });
        Object.defineProperty(this, 'responses', {
          value: new MockResponses(client),
          configurable: true,
        });
        Object.defineProperty(this, 'guardrails', {
          value: {
            chat: new MockChat(client),
            responses: new MockResponses(client),
          },
          configurable: true,
        });
      });

    const instance = await GuardrailsAzureOpenAI.create({ output: { guardrails: [] } }, { apiKey: 'azure-key' }, false);

    const guardrailsClient = (instance as unknown as TestGuardrailsOpenAI).guardrailsClient ?? (instance.guardrails.chat as unknown as TestChat).client as MockGuardrailsClient;
    expect(guardrailsClient.raiseGuardrailErrors).toBe(false);

    const resourceClient = guardrailsClient._resourceClient;
    expect(resourceClient).toBeInstanceOf(MockAzureOpenAI);
    expect(resourceClient.apiKey).toBe('azure-key');

    const guardrailCtx = guardrailsClient.context.guardrailLlm;
    expect(guardrailCtx).toBeInstanceOf(MockAzureOpenAI);
    expect(guardrailCtx).not.toBe(resourceClient);

    overrideSpy.mockRestore();
  });
});
