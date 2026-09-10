import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAI, AzureOpenAI } from 'openai';
import { GuardrailsBaseClient } from '../../base-client';
import { defaultSpecRegistry } from '../../registry';
import { PIIEntity } from '../../checks/pii';
import { GuardrailTripwireTriggered } from '../../exceptions';
import { Chat } from '../../resources/chat/chat';
import { Responses } from '../../resources/responses/responses';

class PreflightClient extends GuardrailsBaseClient {
  constructor(resource: OpenAI, block: boolean) {
    super();
    this._resourceClient = resource;
    this.context = this.createDefaultContext();
    this.guardrails = {
      pre_flight: [defaultSpecRegistry.get('Contains PII')!.instantiate({
        entities: [PIIEntity.EMAIL_ADDRESS], block, detect_encoded_pii: true,
      })],
      input: [],
      output: [],
    };
  }

  protected createDefaultContext() {
    return { guardrailLlm: this._resourceClient };
  }

  protected overrideResources(): void {
    // Resource adapters are constructed explicitly in these tests.
  }
}

afterEach(() => vi.restoreAllMocks());

describe.each(['OpenAI', 'Azure'] as const)('%s PII size rejection in preflight', (provider) => {
  describe.each(['chat', 'responses'] as const)('%s', (api) => {
    it.each([false, true])('blocks before transmission with block=%s, regardless of execution-error policy', async (block) => {
      const fetch = vi.fn();
      const resource = provider === 'Azure'
        ? new AzureOpenAI({ apiKey: 'test-key', endpoint: 'https://example.invalid', apiVersion: '2024-10-21', fetch })
        : new OpenAI({ apiKey: 'test-key', fetch });
      const client = new PreflightClient(resource, block);
      for (const raiseGuardrailErrors of [false, true]) {
        client.raiseGuardrailErrors = raiseGuardrailErrors;
        // The small candidate is inert; only its measured decoded size is mocked.
        vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValueOnce(new Uint8Array(10_001));
        const text = 'john@example.com %68%65%6c%6c%6f';
        const pending = api === 'chat'
          ? new Chat(client).completions.create({ model: 'test-model', messages: [{ role: 'user', content: text }] })
          : new Responses(client).create({ model: 'test-model', input: text });
        await expect(pending).rejects.toBeInstanceOf(GuardrailTripwireTriggered);
        expect(fetch).not.toHaveBeenCalled();
      }
    });
  });
});
