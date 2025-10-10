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
    expect(result.info?.error).toBe('Moderation API call failed');
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
