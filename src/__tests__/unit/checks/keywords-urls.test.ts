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

  it('ignores text without the configured keywords', async () => {
    const result = await keywordsCheck(
      {},
      'All clear content',
      KeywordsConfig.parse({ keywords: ['secret'] })
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.matchedKeywords).toEqual([]);
  });

	it('should not match partial words', async () => {
		const result = await keywordsCheck({}, 'Hello, world!', KeywordsConfig.parse({ keywords: ['orld'] }));
		expect(result.tripwireTriggered).toEqual(false);
	});

	it('should match numbers', async () => {
		const result = await keywordsCheck({}, 'Hello, world123', KeywordsConfig.parse({ keywords: ['world123'] }));
		expect(result.tripwireTriggered).toEqual(true);
		expect(result.info.matchedKeywords).toEqual(['world123']);
	});

	it('should not match partial numbers', async () => {
		const result = await keywordsCheck({}, 'Hello, world12345', KeywordsConfig.parse({ keywords: ['world123'] }));
		expect(result.tripwireTriggered).toEqual(false);
	});

	it('should match underscore', async () => {
		const result = await keywordsCheck({}, 'Hello, w_o_r_l_d', KeywordsConfig.parse({ keywords: ['w_o_r_l_d'] }));
		expect(result.tripwireTriggered).toEqual(true);
		expect(result.info.matchedKeywords).toEqual(['w_o_r_l_d']);
	});

	it('should not match in between underscore', async () => {
		const result = await keywordsCheck({}, 'Hello, test_world_test', KeywordsConfig.parse({ keywords: ['world'] }));
		expect(result.tripwireTriggered).toEqual(false);
	});

	it('should work with chinese characters', async () => {
		const result = await keywordsCheck({}, '你好', KeywordsConfig.parse({ keywords: ['你好'] }));
		expect(result.tripwireTriggered).toEqual(true);
	});

	it('should work with chinese characters with numbers', async () => {
		const result = await keywordsCheck({}, '你好123', KeywordsConfig.parse({ keywords: ['你好123'] }));
		expect(result.tripwireTriggered).toEqual(true);
		expect(result.info.matchedKeywords).toEqual(['你好123']);
	});

	it('should not match partial chinese characters with numbers', async () => {
		const result = await keywordsCheck({}, '你好12345', KeywordsConfig.parse({ keywords: ['你好123'] }));
		expect(result.tripwireTriggered).toEqual(false);
	});

  it('should apply word boundaries to all keywords in a multi-keyword pattern', async () => {
		const result = await keywordsCheck({}, 'testing hello world', KeywordsConfig.parse({ keywords: ['test', 'hello', 'world'] }));
		expect(result.tripwireTriggered).toEqual(true);
		expect(result.info.matchedKeywords).toEqual(['hello', 'world']);
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
