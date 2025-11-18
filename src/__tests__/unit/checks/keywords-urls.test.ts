/**
 * Focused guardrail tests covering keyword and URL detection behaviour.
 */

import { describe, it, expect } from 'vitest';
import { keywordsCheck, KeywordsConfig } from '../../../checks/keywords';
import { urls } from '../../../checks/urls';
import { competitorsCheck } from '../../../checks/competitors';
import { GuardrailResult } from '../../../types';

describe('keywords guardrail', () => {
  it('detects keywords with trailing punctuation removed', () => {
    const result = keywordsCheck(
      {},
      'Please keep this secret!',
      KeywordsConfig.parse({ keywords: ['secret!!!'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['secret']);
    expect(result.info?.sanitizedKeywords).toEqual(['secret']);
    expect(result.info?.totalKeywords).toBe(1);
  });

  it('ignores text without the configured keywords', () => {
    const result = keywordsCheck(
      {},
      'All clear content',
      KeywordsConfig.parse({ keywords: ['secret'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.matchedKeywords).toEqual([]);
  });

  it('does not match partial words', () => {
    const result = keywordsCheck(
      {},
      'Hello, world!',
      KeywordsConfig.parse({ keywords: ['orld'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
  });

  it('matches numbers', () => {
    const result = keywordsCheck(
      {},
      'Hello, world123',
      KeywordsConfig.parse({ keywords: ['world123'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['world123']);
  });

  it('does not match partial numbers', () => {
    const result = keywordsCheck(
      {},
      'Hello, world12345',
      KeywordsConfig.parse({ keywords: ['world123'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
  });

  it('matches underscores', () => {
    const result = keywordsCheck(
      {},
      'Hello, w_o_r_l_d',
      KeywordsConfig.parse({ keywords: ['w_o_r_l_d'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['w_o_r_l_d']);
  });

  it('does not match when underscores appear inside other words', () => {
    const result = keywordsCheck(
      {},
      'Hello, test_world_test',
      KeywordsConfig.parse({ keywords: ['world'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
  });

  it('matches chinese characters', () => {
    const result = keywordsCheck(
      {},
      '你好',
      KeywordsConfig.parse({ keywords: ['你好'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
  });

  it('matches chinese characters with numbers', () => {
    const result = keywordsCheck(
      {},
      '你好123',
      KeywordsConfig.parse({ keywords: ['你好123'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['你好123']);
  });

  it('does not match partial chinese characters with numbers', () => {
    const result = keywordsCheck(
      {},
      '你好12345',
      KeywordsConfig.parse({ keywords: ['你好123'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
  });

  it('applies word boundaries across multi-keyword patterns', () => {
    const result = keywordsCheck(
      {},
      'testing hello world',
      KeywordsConfig.parse({ keywords: ['test', 'hello', 'world'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['hello', 'world']);
  });

  it('matches keywords that start with special characters embedded in text', () => {
    const result = keywordsCheck(
      {},
      'Reach me via example@foo.com later',
      KeywordsConfig.parse({ keywords: ['@foo'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['@foo']);
  });

  it('matches keywords that start with # even when preceded by letters', () => {
    const result = keywordsCheck(
      {},
      'Use example#foo for the ID',
      KeywordsConfig.parse({ keywords: ['#foo'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['#foo']);
  });

  it('ignores keywords that become empty after sanitization', () => {
    const result = keywordsCheck(
      {},
      'Totally benign text',
      KeywordsConfig.parse({ keywords: ['!!!'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.matchedKeywords).toEqual([]);
    expect(result.info?.sanitizedKeywords).toEqual(['']);
  });

  it('still matches other keywords when some sanitize to empty strings', () => {
    const result = keywordsCheck(
      {},
      'Please keep this secret!',
      KeywordsConfig.parse({ keywords: ['...', 'secret!!!'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['secret']);
  });

  it('matches keywords ending with special characters', () => {
    const result = keywordsCheck(
      {},
      'Use foo@ in the config',
      KeywordsConfig.parse({ keywords: ['foo@'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['foo@']);
  });

  it('matches keywords ending with punctuation when followed by word characters', () => {
    const result = keywordsCheck(
      {},
      'Check foo@example',
      KeywordsConfig.parse({ keywords: ['foo@'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['foo@']);
  });

  it('matches mixed script keywords', () => {
    const result = keywordsCheck(
      {},
      'Welcome to hello你好world section',
      KeywordsConfig.parse({ keywords: ['hello你好world'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['hello你好world']);
  });

  it('does not match partial mixed script keywords', () => {
    const result = keywordsCheck(
      {},
      'This is hello你好worldextra',
      KeywordsConfig.parse({ keywords: ['hello你好world'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(false);
  });

  it('matches Arabic characters', () => {
    const result = keywordsCheck(
      {},
      'مرحبا بك',
      KeywordsConfig.parse({ keywords: ['مرحبا'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['مرحبا']);
  });

  it('matches Cyrillic characters', () => {
    const result = keywordsCheck(
      {},
      'Привет мир',
      KeywordsConfig.parse({ keywords: ['Привет'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['Привет']);
  });

  it('matches keywords with only punctuation', () => {
    const result = keywordsCheck(
      {},
      'Use the @@ symbol',
      KeywordsConfig.parse({ keywords: ['@@'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['@@']);
  });

  it('matches mixed punctuation and alphanumeric keywords', () => {
    const result = keywordsCheck(
      {},
      'Contact via @user123@',
      KeywordsConfig.parse({ keywords: ['@user123@'] })
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.matchedKeywords).toEqual(['@user123@']);
  });
});

describe('urls guardrail', () => {
  it('allows https URLs listed in the allow list', async () => {
    const result = await urls(
      {},
      'Visit https://example.com/docs for docs.',
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      }
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.allowed).toContain('https://example.com/docs');
    expect(result.info?.blocked).toEqual([]);
  });

  it('blocks disallowed schemes and userinfo by default', async () => {
    const text = [
      'http://plain-http.com',
      'https://user:pass@secure.example.com',
      'javascript:alert(1)',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: [],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toEqual([
      'http://plain-http.com',
      'https://user:pass@secure.example.com',
      'javascript:alert(1)',
    ]);
    expect((result.info?.blocked_reasons as string[])?.some((reason: string) => reason.includes('Blocked scheme: http'))).toBe(true);
    expect((result.info?.blocked_reasons as string[])?.some((reason: string) => reason.includes('Contains userinfo'))).toBe(true);
  });

  it('honours subdomain allowance settings', async () => {
    const result = await urls(
      {},
      'Check https://sub.example.com and https://other.com',
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: true,
        block_userinfo: true,
      }
    );

    expect(result.info?.allowed).toContain('https://sub.example.com');
    expect(result.info?.blocked).toContain('https://other.com');
    expect(result.tripwireTriggered).toBe(true);
  });
});

describe('competitors guardrail', () => {
  it('reuses keywords check and annotates guardrail name', () => {
    const result = competitorsCheck(
      {},
      'We prefer Acme Corp over others.',
      { keywords: ['acme corp'] }
    ) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.guardrail_name).toBe('Competitors');
    expect(result.info?.matchedKeywords).toContain('Acme Corp');
  });
});
