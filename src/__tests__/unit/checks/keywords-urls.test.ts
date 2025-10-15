/**
 * Focused guardrail tests covering keyword and URL detection behaviour.
 */

import { describe, it, expect } from 'vitest';
import { keywordsCheck, KeywordsConfig } from '../../../checks/keywords';
import { urls } from '../../../checks/urls';
import { competitorsCheck } from '../../../checks/competitors';

describe('keywords guardrail', () => {
  it('detects keywords with trailing punctuation removed', () => {
    const result = keywordsCheck(
      {},
      'Please keep this secret!',
      KeywordsConfig.parse({ keywords: ['secret!!!'] })
    );

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
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.matchedKeywords).toEqual([]);
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
    expect(result.info?.blocked_reasons?.some((reason: string) => reason.includes('Blocked scheme: http'))).toBe(true);
    expect(result.info?.blocked_reasons?.some((reason: string) => reason.includes('Contains userinfo'))).toBe(true);
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
  it('reuses keywords check and annotates guardrail name', async () => {
    const result = await competitorsCheck(
      {},
      'We prefer Acme Corp over others.',
      { keywords: ['acme corp'] }
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.guardrail_name).toBe('Competitors');
    expect(result.info?.matchedKeywords).toContain('Acme Corp');
  });
});
