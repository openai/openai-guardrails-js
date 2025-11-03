/**
 * Guardrail tests for moderation and secret key detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { moderationCheck, Category, ModerationConfig } from '../../../checks/moderation';
import { secretKeysCheck, SecretKeysConfig } from '../../../checks/secret-keys';

const createMock = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      public moderations = {
        create: createMock,
      };
    },
  };
});

describe('moderation guardrail', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('flags configured categories returned by the moderation API', async () => {
    createMock.mockResolvedValue({
      results: [
        {
          categories: {
            [Category.HATE]: true,
            [Category.VIOLENCE]: false,
          },
        },
      ],
    });

    const result = await moderationCheck(
      {},
      'bad content',
      ModerationConfig.parse({ categories: [Category.HATE, Category.VIOLENCE] })
    );

    expect(createMock).toHaveBeenCalledWith({
      model: 'omni-moderation-latest',
      input: 'bad content',
      safety_identifier: 'openai-guardrails-js',
    });
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.flagged_categories).toEqual([Category.HATE]);
    expect(result.info?.categories_checked).toEqual([Category.HATE, Category.VIOLENCE]);
    expect(result.info?.category_details).toMatchObject({
      [Category.HATE]: true,
      [Category.VIOLENCE]: false,
    });
  });

  it('returns non-triggering result when API fails', async () => {
    createMock.mockRejectedValue(new Error('network down'));

    const result = await moderationCheck({}, 'safe text', ModerationConfig.parse({}));

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    expect(result.originalException).toBeDefined();
    expect(result.info?.error).toContain('network down');
  });

  it('returns executionFailed for API key errors to support raiseGuardrailErrors', async () => {
    const apiKeyError = new Error(
      'Incorrect API key provided: sk-invalid. You can find your API key at https://platform.openai.com/account/api-keys.'
    );
    createMock.mockRejectedValue(apiKeyError);

    const result = await moderationCheck({}, 'test text', ModerationConfig.parse({}));

    expect(result.tripwireTriggered).toBe(false);
    expect(result.executionFailed).toBe(true);
    expect(result.originalException).toBe(apiKeyError);
    expect(result.info?.error).toContain('Incorrect API key');
  });

  it('uses context client when available', async () => {
    // Track whether context client was used
    let contextClientUsed = false;
    const contextCreateMock = vi.fn().mockImplementation(async () => {
      contextClientUsed = true;
      return {
        results: [
          {
            categories: {
              [Category.HATE]: false,
              [Category.VIOLENCE]: false,
            },
          },
        ],
      };
    });

    // Create a context with a guardrailLlm client
    // We need to import OpenAI to create a proper instance
    const OpenAI = (await import('openai')).default;
    const contextClient = new OpenAI({ apiKey: 'test-context-key' });
    contextClient.moderations = {
      create: contextCreateMock,
    } as unknown as typeof contextClient.moderations;

    const ctx = { guardrailLlm: contextClient };
    const cfg = ModerationConfig.parse({ categories: [Category.HATE] });
    const result = await moderationCheck(ctx, 'test text', cfg);

    // Verify the context client was used
    expect(contextClientUsed).toBe(true);
    expect(contextCreateMock).toHaveBeenCalledWith({
      model: 'omni-moderation-latest',
      input: 'test text',
      safety_identifier: 'openai-guardrails-js',
    });
    expect(result.tripwireTriggered).toBe(false);
  });

  it('falls back to default client for third-party providers', async () => {
    // Track whether fallback client was used
    let fallbackUsed = false;
    
    // The default mock from vi.mock will be used for the fallback
    createMock.mockImplementation(async () => {
      fallbackUsed = true;
      return {
        results: [
          {
            categories: {
              [Category.HATE]: false,
            },
          },
        ],
      };
    });

    // Create a context client that simulates a third-party provider
    // When moderation is called, it should raise a 404 error
    const contextCreateMock = vi.fn().mockRejectedValue({
      status: 404,
      message: '404 page not found',
    });

    const OpenAI = (await import('openai')).default;
    const thirdPartyClient = new OpenAI({ apiKey: 'third-party-key', baseURL: 'https://localhost:8080/v1' });
    thirdPartyClient.moderations = {
      create: contextCreateMock,
    } as unknown as typeof thirdPartyClient.moderations;

    const ctx = { guardrailLlm: thirdPartyClient };
    const cfg = ModerationConfig.parse({ categories: [Category.HATE] });
    const result = await moderationCheck(ctx, 'test text', cfg);

    // Verify the fallback client was used (not the third-party one)
    expect(contextCreateMock).toHaveBeenCalled();
    expect(fallbackUsed).toBe(true);
    expect(result.tripwireTriggered).toBe(false);
  });
});

describe('secret key guardrail', () => {
  it('detects and masks secret candidates', async () => {
    const text = 'Here is a token sk-1234567890 and some safe text.';

    const result = await secretKeysCheck(
      {},
      text,
      SecretKeysConfig.parse({ threshold: 'strict' })
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected_secrets).toContain('sk-1234567890');
    expect(result.info?.checked_text).toContain('<SECRET>');
    expect(result.info?.checked_text).not.toContain('sk-1234567890');
  });

  it('respects custom regex patterns', async () => {
    const result = await secretKeysCheck(
      {},
      'custom-secret-ABC123',
      SecretKeysConfig.parse({ threshold: 'permissive', custom_regex: ['custom-secret-[A-Z0-9]+'] })
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected_secrets).toContain('custom-secret-ABC123');
  });
});
