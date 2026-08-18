/**
 * Focused guardrail tests covering keyword and URL detection behaviour.
 */

import { describe, it, expect } from 'vitest';
import { keywordsCheck, KeywordsConfig } from '../../../checks/keywords';
import { urls, UrlsConfig } from '../../../checks/urls';
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

describe('UrlsConfig', () => {
  it('normalizes allowed scheme inputs', () => {
    const config = UrlsConfig.parse({
      allowed_schemes: ['HTTPS://', 'http:', '  https  '],
    });

    expect(Array.from(config.allowed_schemes).sort()).toEqual(['http', 'https']);
  });
});

describe('urls guardrail', () => {
  const defaultUrlConfig = {
    url_allow_list: [],
    allowed_schemes: new Set(['https']),
    block_userinfo: true,
    allow_subdomains: false,
  };

  it('allows https URLs listed in the allow list', async () => {
    const result = await urls({}, 'Visit https://example.com/docs for docs.', {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

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
    expect(
      (result.info?.blocked_reasons as string[])?.some((reason: string) =>
        reason.includes('Blocked scheme: http')
      )
    ).toBe(true);
    expect(
      (result.info?.blocked_reasons as string[])?.some((reason: string) =>
        reason.includes('Contains userinfo')
      )
    ).toBe(true);
  });

  it.each([
    ['TAB', '\t'],
    ['LF', '\n'],
    ['CR', '\r'],
  ])('blocks %s-obfuscated HTTP URLs before WHATWG normalization', async (_name, control) => {
    const rawUrl = `htt${control}p://2130706433/internal/credentials`;
    const parsed = new URL(rawUrl);

    expect(parsed.protocol).toBe('http:');
    expect(parsed.hostname).toBe('127.0.0.1');

    const result = await urls({}, rawUrl, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toContain(rawUrl);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toContain(rawUrl);
    expect(result.info?.blocked_reasons).toContain(
      `${rawUrl}: Ambiguous URL containing ASCII control characters`
    );
  });

  it('blocks controls at every internal position in recognized schemes', async () => {
    const cases = [
      ['http', '://example.com'],
      ['https', '://example.com'],
      ['ftp', '://example.com'],
      ['ws', '://example.com'],
      ['wss', '://example.com'],
      ['file', ':///etc/passwd'],
      ['data', ':text/plain,payload'],
      ['javascript', ':alert(1)'],
      ['vbscript', ':msgbox(1)'],
      ['mailto', ':user@example.com'],
    ] as const;

    for (const control of ['\t', '\n', '\r']) {
      for (const [scheme, suffix] of cases) {
        for (let index = 1; index < scheme.length; index += 1) {
          const rawUrl = `${scheme.slice(0, index)}${control}${scheme.slice(index)}${suffix}`;
          const result = await urls({}, rawUrl, defaultUrlConfig);

          expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
          expect(result.info?.blocked, JSON.stringify(rawUrl)).toContain(rawUrl);
        }
      }
    }
  });

  it.each([
    ['ws', 'ws://allowed.example/path'],
    ['wss', 'wss://allowed.example/path'],
    ['gopher', 'gopher://allowed.example/path'],
  ])('allows an explicitly configured %s URL', async (scheme, rawUrl) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set([scheme]),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('allows an explicitly configured mailto URL', async () => {
    const rawUrl = 'mailto:user@example.com';
    const result = await urls({}, rawUrl, {
      url_allow_list: [],
      allowed_schemes: new Set(['mailto']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['ws', 'ws://allowed.example/path'],
    ['wss', 'wss://allowed.example/path'],
    ['gopher', 'gopher://allowed.example/path'],
    ['file', 'file:///etc/passwd'],
    ['single-slash file', 'file:/etc/passwd'],
    ['mailto', 'mailto:user@example.com'],
    ['uppercase mailto', 'MAILTO:user@example.com'],
  ])('blocks a normally spelled disallowed %s URL', async (_scheme, rawUrl) => {
    const result = await urls({}, rawUrl, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['WebSocket scheme letters', 'w\ts://allowed.example/path', 'ws:'],
    ['secure WebSocket scheme letters', 'ws\ts://allowed.example/path', 'wss:'],
    ['file scheme letters', 'fi\tle:///etc/passwd', 'file:'],
    ['mailto scheme letters', 'mai\tlto:user@allowed.example', 'mailto:'],
    ['scheme letters', 'gop\ther://allowed.example/path', 'gopher:'],
    ['scheme letters across a line', 'gop\nher://allowed.example/path', 'gopher:'],
    ['authority separators', 'custom:\t//allowed.example/path', 'custom:'],
    ['hostless scheme letters', 'cus\ttom:payload', 'custom:'],
  ])(
    'blocks a control-obfuscated generic URL across %s',
    async (_name, rawUrl, expectedProtocol) => {
      expect(new URL(rawUrl).protocol).toBe(expectedProtocol);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['Markdown emphasis after punctuation', 'See:_allowed.example/safe_', 'allowed.example/safe'],
    ['nested wrappers after punctuation', 'See:(_allowed.example/safe_)', 'allowed.example/safe'],
    ['an emphasized IP after punctuation', 'Host:_127.0.0.1/safe_', '127.0.0.1/safe'],
    ['an emphasized IPv6 address', 'Host:_[::1]/safe_', '[::1]/safe'],
    ['a parenthesized IPv6 address', 'Host:([::1]/safe)', '[::1]/safe'],
  ])('detects a wrapped scheme-less URL in %s', async (_name, input, rawUrl) => {
    const result = await urls({}, input, {
      url_allow_list: [rawUrl],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not treat an emphasized domain inside a scheme-less path as a separate URL', async () => {
    const rawUrl = 'allowed.example/_nested.example_';
    const result = await urls({}, rawUrl, {
      url_allow_list: [rawUrl],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not treat a parenthesized integer as a wrapped scheme-less URL', async () => {
    const result = await urls({}, 'Version:(1)', {
      url_allow_list: [],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not treat a function argument integer as a wrapped scheme-less URL', async () => {
    const result = await urls({}, 'Version:fn(1)', {
      url_allow_list: [],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not split a scheme-less URL at a query assignment', async () => {
    const rawUrl = 'allowed.example/safe?next=other.example/path';
    const result = await urls({}, rawUrl, {
      url_allow_list: [rawUrl],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['an attribute', 'href="allowed.example/safe",next=x', ['allowed.example/safe']],
    ['an unquoted HTML attribute', '<a href=allowed.example/safe>', ['allowed.example/safe']],
    [
      'multiple unquoted HTML attributes',
      '<a href=allowed.example/safe data-src=other.example/path>',
      ['allowed.example/safe', 'other.example/path'],
    ],
    ['a CSS url function', 'url(allowed.example/safe)', ['allowed.example/safe']],
    ['a quoted CSS url function', 'url("allowed.example/safe")', ['allowed.example/safe']],
    [
      'a CSS url function with inner whitespace',
      'url( allowed.example/safe)',
      ['allowed.example/safe'],
    ],
    [
      'adjacent CSS url functions',
      'url(allowed.example/safe),url(other.example/path)',
      ['allowed.example/safe', 'other.example/path'],
    ],
    ['a braced value', '{allowed.example/safe}', ['allowed.example/safe']],
    [
      'adjacent braced values',
      '{allowed.example/safe}{other.example/path}',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'comma-separated braced values',
      '{allowed.example/safe},{other.example/path}',
      ['allowed.example/safe', 'other.example/path'],
    ],
    ['a pipe-delimited value', '|allowed.example/safe|', ['allowed.example/safe']],
    [
      'adjacent pipe-delimited values',
      '|allowed.example/safe|other.example/path|',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'pipe-delimited values with an empty column',
      '|allowed.example/safe||other.example/path|',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'comma-separated quoted values',
      '"allowed.example/safe","other.example/path"',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'comma-separated Markdown-emphasized values',
      '*allowed.example/safe*,*other.example/path*',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'adjacent underscore-emphasized values',
      '_allowed.example/safe__other.example/path_',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'adjacent inline-code values',
      '`allowed.example/safe``other.example/path`',
      ['allowed.example/safe', 'other.example/path'],
    ],
    ['an angle-delimited value', '<allowed.example/safe>,next', ['allowed.example/safe']],
    ['an inline-code value', '`allowed.example/safe`,next', ['allowed.example/safe']],
    [
      'a quoted URL with a scheme-like query value',
      '"allowed.example/safe?next=data:value"',
      ['allowed.example/safe?next=data:value'],
    ],
    [
      'minified JSON fields',
      '{"a":"allowed.example/safe","b":"other.example/path"}',
      ['allowed.example/safe', 'other.example/path'],
    ],
    [
      'single-quoted fields',
      "{'a':'allowed.example/it's-safe','b':'other.example/path'}",
      ["allowed.example/it's-safe", 'other.example/path'],
    ],
    [
      'escaped quotes in a JSON value',
      String.raw`{"url":"allowed.example/safe?label=\"value\"","other":"other.example/path"}`,
      [String.raw`allowed.example/safe?label=\"value\"`, 'other.example/path'],
    ],
    [
      'an even backslash run before a JSON delimiter',
      String.raw`{"url":"allowed.example/safe?path=\\","other":"other.example/path"}`,
      [String.raw`allowed.example/safe?path=\\`, 'other.example/path'],
    ],
  ])('separates wrapped scheme-less URLs in %s', async (_name, input, rawUrls) => {
    const result = await urls({}, input, {
      url_allow_list: rawUrls,
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(rawUrls);
    expect(result.info?.allowed).toEqual(rawUrls);
    expect(result.info?.blocked).toEqual([]);
  });

  it('keeps an ambiguous sibling wrapper fail closed', async () => {
    const allowedUrl = 'allowed.example/safe';
    const ambiguousUrl = '{allowed/.example/safe}';
    const result = await urls({}, `{${allowedUrl}}${ambiguousUrl}`, {
      url_allow_list: [allowedUrl, 'allowed'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([allowedUrl, ambiguousUrl]);
    expect(result.info?.allowed).toEqual([allowedUrl]);
    expect(result.info?.blocked).toEqual([ambiguousUrl]);
  });

  it.each([
    ['an unscoped assignment terminator', 'src=allowed.example/safe>'],
    ['a comparison before an assignment', '2 < 3 src=allowed.example/safe>'],
    ['an excluded delimiter in an HTML attribute path', '<a href=allowed.example/safe^extra>'],
  ])('keeps %s in the fail-closed candidate', async (_name, input) => {
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example/safe'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual(result.info?.detected);
  });

  it.each([
    ['javascript', 'javascript:"allowed.example/safe"'],
    ['data', 'data:<allowed.example/safe>'],
    ['vbscript', 'vbscript:`allowed.example/safe`'],
    ['mailto', 'mailto:{user@allowed.example}'],
  ])('blocks a %s URL whose payload starts with a delimiter', async (_name, rawUrl) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example/safe'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['quote at the host start', 'gopher://"allowed.example/safe', '"allowed.example'],
    ['quote within the host', 'custom://a"%2e/allowed.example/safe', 'a"%2e'],
  ])('validates a generic authority URL with a %s', async (_name, rawUrl, expectedHost) => {
    const parsedUrl = new URL(rawUrl);
    expect(parsedUrl.hostname).toBe(expectedHost);

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set([parsedUrl.protocol.slice(0, -1)]),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('does not let an unrelated scheme-like prefix hide an obfuscated generic URL', async () => {
    const rawUrl = 'gop\ther://allowed.example/path';
    const input = `prefix:payload,${rawUrl}`;
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['her']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(new URL(rawUrl).protocol).toBe('gopher:');
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['http without slashes', 'http:allowed.example/path', 'http:'],
    ['http with one slash', 'http:/allowed.example/path', 'http:'],
    ['http with a backslash', 'http:\\allowed.example/path', 'http:'],
    ['ftp without slashes', 'ftp:allowed.example/path', 'ftp:'],
    ['WebSocket with one slash', 'ws:/allowed.example/path', 'ws:'],
    ['secure WebSocket with a backslash', 'wss:\\allowed.example/path', 'wss:'],
    ['http with a slashless IPv6 host', 'http:[::1]/path', 'http:'],
    ['WebSocket with a slashless IPv6 host', 'ws:[::1]/path', 'ws:'],
  ])(
    'blocks a disallowed WHATWG special scheme expressed as %s',
    async (_name, rawUrl, expectedProtocol) => {
      const parsedUrl = new URL(rawUrl);
      expect(parsedUrl.protocol).toBe(expectedProtocol);
      expect(['allowed.example', '[::1]']).toContain(parsedUrl.hostname);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example', '[::1]'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toContain(rawUrl);
      expect(result.info?.allowed).not.toContain(rawUrl);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['a forward-slash path', 'https:intranet//allowed.example/safe', 'intranet'],
    ['a backslash path', 'https:internal\\allowed.example/safe', 'internal'],
    ['punctuation before slashes', 'https:;//allowed.example/safe', ';'],
  ])(
    'validates the outer host of a slashless special URL with %s',
    async (_name, rawUrl, expectedHost) => {
      expect(new URL(rawUrl).hostname).toBe(expectedHost);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toContain(rawUrl);
      expect(result.info?.allowed).not.toContain(rawUrl);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    [
      'query before NBSP',
      'https:intranet?\u00a0//allowed.example/safe',
      'intranet',
      'https:intranet?',
    ],
    [
      'fragment before OGHAM SPACE MARK',
      'https:internal#\u1680//allowed.example/safe',
      'internal',
      'https:internal#',
    ],
  ])(
    'validates a slashless special URL with a %s',
    async (_name, rawUrl, expectedHost, expectedBlockedUrl) => {
      expect(new URL(rawUrl).hostname).toBe(expectedHost);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toContain(expectedBlockedUrl);
      expect(result.info?.allowed).not.toContain(expectedBlockedUrl);
      expect(result.info?.blocked).toContain(expectedBlockedUrl);
    }
  );

  it.each([
    ['control before a path separator', 'allowed\r/.example:444/safe', 'allowed'],
    ['control before a userinfo separator', 'allowed.\t@example:444/safe', 'example'],
    ['control after a trailing host dot', 'allowed.\r/example:444/safe', 'allowed.'],
    ['IDNA control before userinfo', '例え.\t@テスト/safe', 'xn--zckzah'],
  ])(
    'fails closed for an entire scheme-less URL with a %s',
    async (_name, rawUrl, expectedHost) => {
      expect(new URL(`http://${rawUrl}`).hostname).toBe(expectedHost);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['http://allowed.example:444/safe'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['quote within a label', 'allowed".example:444/safe', 'allowed".example'],
    ['brace after a separator', 'allowed.{example:444/safe', 'allowed.{example'],
    ['quote before userinfo', 'allowed.example"@intranet:444/safe', 'intranet'],
  ])('validates a scheme-less dotted authority with a %s', async (_name, rawUrl, expectedHost) => {
    expect(new URL(`http://${rawUrl}`).hostname).toBe(expectedHost);

    const result = await urls({}, rawUrl, {
      url_allow_list: ['http://allowed.example:444/safe'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['quote', 'https:"%2e//allowed.example/safe', '".'],
    ['opening brace', 'https:{%2e//allowed.example/safe', '{.'],
    ['closing brace', 'https:}%2e//allowed.example/safe', '}.'],
    ['backtick', 'https:`%2e//allowed.example/safe', '`.'],
    ['label then quote', 'https:a"%2e//allowed.example/safe', 'a".'],
    ['quote after one slash', 'https:/"%2e/allowed.example/safe', '".'],
    ['quote at the host start', 'https://"allowed.example/safe', '"allowed.example'],
  ])(
    'validates a delayed special-scheme authority after a %s',
    async (_name, rawUrl, expectedHost) => {
      expect(new URL(rawUrl).hostname).toBe(expectedHost);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['path separator before a dotted suffix', 'allowed/.example/safe', 'allowed'],
    ['encoded separator after a dot', 'allowed.%2eexample/safe', 'allowed..example'],
    ['path separator within a label', 'allowed.e/xample/safe', 'allowed.e'],
    ['IDNA path separator before a dotted suffix', '例え/.テスト/safe', 'xn--r8jz45g'],
    ['IDNA encoded separator after a dot', '例え.%2eテスト/safe', 'xn--r8jz45g..xn--zckzah'],
  ])(
    'validates an entire strong scheme-less URL with a %s',
    async (_name, rawUrl, expectedHost) => {
      expect(new URL(`http://${rawUrl}`).hostname).toBe(expectedHost);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['http://allowed.example:444/safe'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['path separator before a dotted suffix', 'allowed/.example/safe'],
    ['encoded separator after a dot', 'allowed.%2eexample/safe'],
    ['path separator within a label', 'allowed.e/xample/safe'],
    ['IDNA path separator before a dotted suffix', '例え/.テスト/safe'],
  ])('validates an embedded strong scheme-less URL with a %s', async (_name, rawUrl) => {
    const result = await urls({}, `Visit ${rawUrl} today`, {
      url_allow_list: [],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['parentheses', '(', ')'],
    ['brackets', '[', ']'],
    ['Markdown emphasis', '_', '_'],
    ['nested Markdown emphasis', '**', '**'],
    ['inline code', '`', '`'],
    ['double quotes', '"', '"'],
    ['angle brackets', '<', '>'],
    ['an unmatched parenthesis', '(', ''],
    ['unmatched Markdown emphasis', '_', ''],
    ['nested leading punctuation', '([`', ''],
    ['word-prefixed punctuation', 'x_', ''],
  ])('validates a strong scheme-less URL wrapped in %s', async (_name, opening, closing) => {
    const rawUrl = 'allowed/.example/safe';
    const wrappedUrl = `${opening}${rawUrl}${closing}`;
    const result = await urls({}, `Visit ${wrappedUrl} today`, {
      url_allow_list: ['allowed'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([wrappedUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([wrappedUrl]);
  });

  it.each([
    ['source path', 'src/package.test:123', 'package.test'],
    ['documentation path', 'docs/readme.md:42/path', 'readme.md'],
  ])('keeps a %s outside the disrupted URL heuristic', async (_name, input, dottedName) => {
    for (const text of [input, `Visit ${input} today`]) {
      const result = await urls({}, text, {
        url_allow_list: [dottedName],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered, text).toBe(false);
      expect(result.info?.detected, text).toEqual([dottedName]);
      expect(result.info?.allowed, text).toEqual([dottedName]);
      expect(result.info?.blocked, text).toEqual([]);
    }
  });

  it.each([
    ['parenthesized domain', '(', 'allowed.example/safe', ')', ''],
    ['fullwidth parenthesized domain', '（', 'allowed.example/safe', '）', ''],
    ['Markdown-emphasized domain', '_', 'allowed.example/safe', '_', ''],
    ['nested Markdown-emphasized domain', '**', 'allowed.example/safe', '**', ''],
    ['inline-code domain', '`', 'allowed.example/safe', '`', ''],
    ['double-quoted domain', '"', 'allowed.example/safe', '"', ''],
    ['angle-bracketed domain', '<', 'allowed.example/safe', '>', ''],
    ['quoted domain followed by punctuation', "'", 'allowed.example/safe', "'", '.'],
    ['fullwidth-quoted domain followed by punctuation', '「', 'allowed.example/safe', '」', '。'],
    [
      'parenthesized domain with a closing parenthesis in its path',
      '(',
      'allowed.example/safe)',
      ')',
      '',
    ],
    ['parenthesized IP address', '(', '127.0.0.1/safe', ')', ''],
  ])(
    'removes prose wrappers from a normal scheme-less %s',
    async (_name, opening, rawUrl, closing, punctuation) => {
      const result = await urls({}, `Visit ${opening}${rawUrl}${closing}${punctuation} today`, {
        url_allow_list: [rawUrl],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([rawUrl]);
      expect(result.info?.blocked).toEqual([]);
    }
  );

  it.each([
    ['Unicode IDNA', '例え.テスト/safe', '例え.テスト'],
    ['punycode IDNA', 'xn--r8jz45g.xn--zckzah/safe', '例え.テスト'],
    ['compatibility character', 'ℓ.com/safe', 'l.com'],
    ['supplementary-plane IDNA', '😀.example/safe', '😀.example'],
  ])('detects a normal scheme-less %s host', async (_name, rawUrl, allowedHost) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: [allowedHost],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('preserves the port, path, query, and fragment of a normal scheme-less URL', async () => {
    const rawUrl = 'allowed.example:444/safe?token=allowed#frag';
    const result = await urls({}, rawUrl, {
      url_allow_list: [`http://${rawUrl}`],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each(['"', '`', '{', '}'])(
    'validates a port-bearing scheme-less URL with an attached %s as one raw token',
    async (prefix) => {
      const allowedUrl = 'allowed.example:444/safe?token=allowed#frag';
      const rawUrl = `${prefix}${allowedUrl}`;
      const result = await urls({}, rawUrl, {
        url_allow_list: [`http://${allowedUrl}`],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it('validates a numeric-leading final label when the scheme-less URL has a port', async () => {
    const rawUrl = 'allowed.3example:444/safe?token=allowed#frag';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['http://allowed.example:444/safe?token=allowed#frag'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each(['allowed!.example', 'allowed._example', 'allowed.e_xample'])(
    'validates non-DNS hostname punctuation in %s as part of the raw token',
    async (hostname) => {
      const rawUrl = `${hostname}/safe?token=allowed#frag`;
      const result = await urls({}, rawUrl, {
        url_allow_list: ['http://allowed.example/safe?token=allowed#frag'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['inverted exclamation mark', '¡allowed.example/safe', 'xn--allowed-tha.example'],
    ['middle dot', 'allowed·.example/safe', 'xn--allowed-1ma.example'],
    ['Greek question mark', ';allowed.example/safe', ';allowed.example'],
  ])(
    'validates a scheme-less host containing an IDNA %s',
    async (_name, rawUrl, normalizedHostname) => {
      expect(new URL(`http://${rawUrl}`).hostname).toBe(normalizedHostname);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['an ASCII leading separator', '.allowed.example/safe', '.allowed.example'],
    ['an IDNA leading separator', '。allowed.example/safe', '.allowed.example'],
    ['consecutive IDNA separators', 'allowed。。example/safe', 'allowed..example'],
    ['mixed consecutive separators', 'allowed.．example/safe', 'allowed..example'],
    ['an encoded leading separator', '%2eallowed.example/safe', '.allowed.example'],
    ['consecutive encoded separators', 'allowed%2e%2eexample/safe', 'allowed..example'],
  ])('validates a scheme-less host containing %s', async (_name, rawUrl, normalizedHostname) => {
    expect(new URL(`http://${rawUrl}`).hostname).toBe(normalizedHostname);

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['superscript digit', 'allowed.²example/safe', 'allowed.2example'],
    ['subscript digit', 'allowed.₂example/safe', 'allowed.2example'],
  ])(
    'validates an IDNA final label beginning with a normalized %s',
    async (_name, rawUrl, normalizedHostname) => {
      expect(new URL(`http://${rawUrl}`).hostname).toBe(normalizedHostname);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['a normalized digit', 'allowed.\t²example/safe', 'allowed.2example'],
    ['IDNA punctuation', 'allowed.\t¡example/safe', 'allowed.xn--example-tha'],
    ['encoded separators', 'allowed%2\ne%2eexample/safe', 'allowed..example'],
  ])(
    'fails closed when a control changes %s in a scheme-less host',
    async (_name, rawUrl, normalizedHostname) => {
      expect(new URL(`http://${rawUrl}`).hostname).toBe(normalizedHostname);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    'localhost/internal',
    '2130706433/internal',
    '127.1/internal',
    'foo_bar.example/internal',
    '-allowed.example/internal',
  ])('does not let unrelated text change extended-host detection of %s', async (rawUrl) => {
    const config = {
      url_allow_list: [],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    };
    const baseline = await urls({}, rawUrl, config);
    const contexts = [`日本語 ${rawUrl}`, `% note ${rawUrl}`, `xn-- note ${rawUrl}`];

    for (const input of contexts) {
      const withUnrelatedText = await urls({}, input, config);
      expect(withUnrelatedText.info?.detected, input).toEqual(baseline.info?.detected);
      expect(withUnrelatedText.tripwireTriggered, input).toBe(baseline.tripwireTriggered);
    }
  });

  it.each([
    ['percent escape', '127.1/internal%20path'],
    ['punycode marker', '127.1/internal-xn--marker'],
    ['Unicode', '127.1/日本語'],
  ])('does not let %s in a path activate extended-host detection', async (_name, rawUrl) => {
    const config = {
      url_allow_list: [],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    };
    const baseline = await urls({}, '127.1/internal', config);
    const result = await urls({}, rawUrl, config);

    expect(result.info?.detected).toEqual(baseline.info?.detected);
    expect(result.tripwireTriggered).toBe(baseline.tripwireTriggered);
  });

  it('detects multiple normal scheme-less IDNA hosts independently', async () => {
    const firstUrl = '例え.テスト/safe';
    const secondUrl = 'ℓ.com/path';
    const result = await urls({}, `Visit ${firstUrl} and ${secondUrl}`, {
      url_allow_list: ['例え.テスト', 'l.com'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([firstUrl, secondUrl]);
    expect(result.info?.allowed).toEqual([firstUrl, secondUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not duplicate a scheme-less IDNA host nested in an explicit URL', async () => {
    const rawUrl = 'https://例え.テスト/safe';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['例え.テスト'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('validates a special-scheme path after WHATWG backslash normalization', async () => {
    const rawUrl = 'https://allowed.example/safe\\..\\admin';
    expect(new URL(rawUrl).pathname).toBe('/admin');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['https://allowed.example/safe'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([',', '.', ';', '!', ')'])(
    'removes trailing %j prose punctuation from an authority URL',
    async (punctuation) => {
      const result = await urls({}, `Visit https://allowed.example${punctuation} now`, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual(['https://allowed.example']);
      expect(result.info?.allowed).toEqual(['https://allowed.example']);
      expect(result.info?.blocked).toEqual([]);
    }
  );

  it.each(['。', '．', '｡'])(
    'allows an authority followed by the %j Unicode dot separator',
    async (separator) => {
      const rawUrl = `https://allowed.example${separator}`;
      expect(new URL(rawUrl).hostname).toBe('allowed.example.');

      const result = await urls({}, `Visit ${rawUrl} now`, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([rawUrl]);
      expect(result.info?.blocked).toEqual([]);
    }
  );

  it('treats an allow-list hostname with a trailing dot as equivalent', async () => {
    const rawUrl = 'https://allowed.example/path';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example.'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each(['-', '.', '+'])(
    'detects a disallowed scheme after leading %j punctuation',
    async (punctuation) => {
      const rawUrl = 'http://allowed.example/path';
      const result = await urls({}, `Visit ${punctuation}${rawUrl} now`, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['foo-http', 'foo.http', 'foo+http'])(
    'does not split the allowed outer %s scheme',
    async (scheme) => {
      const rawUrl = `${scheme}://allowed.example/path`;
      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set([scheme]),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([rawUrl]);
      expect(result.info?.blocked).toEqual([]);
    }
  );

  it.each([
    ['Markdown emphasis', '_'],
    ['Markdown strong emphasis', '**'],
  ])('removes closing %s from a bare authority URL', async (_name, marker) => {
    const rawUrl = 'https://allowed.example';
    const result = await urls({}, `Visit ${marker}${rawUrl}${marker} now`, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['a JSON string', '{"url":"https://allowed.example"}', 'https'],
    ['a quoted CSS url', 'url("https://allowed.example")', 'https'],
    ['a generic URL in JSON', '{"url":"custom://allowed.example"}', 'custom'],
  ])('removes paired wrappers from a bare authority URL in %s', async (_name, input, scheme) => {
    const rawUrl = `${scheme}://allowed.example`;
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set([scheme]),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('keeps bare authority URL ownership scoped to each JSON value', async () => {
    const firstUrl = 'https://allowed.example';
    const secondUrl = 'https://other.example';
    const result = await urls({}, `{"first":"${firstUrl}","second":"${secondUrl}"}`, {
      url_allow_list: ['allowed.example', 'other.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([firstUrl, secondUrl]);
    expect(result.info?.allowed).toEqual([firstUrl, secondUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('keeps unpaired excluded authority delimiters fail closed', async () => {
    const rawUrl = 'https://allowed.example"}';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['parenthesized path', '(', 'https://allowed.example/safe', ')'],
    ['emphasized query', '_', 'https://allowed.example/safe?token=allowed', '_'],
    ['strongly emphasized fragment', '**', 'https://allowed.example/safe#section', '**'],
    ['nested wrappers', '(**', 'https://allowed.example/safe', '**)'],
    ['parenthesized path before a period', '(', 'https://allowed.example/safe', ').'],
    ['parenthesized path before a question mark', '(', 'https://allowed.example/safe', ')?'],
    ['strongly emphasized path before a comma', '**', 'https://allowed.example/safe', '**,'],
    ['single-quoted path', "'", 'https://allowed.example/safe', "'"],
    ['struck-through path', '~~', 'https://allowed.example/safe', '~~'],
    ['fullwidth parenthesized path', '（', 'https://allowed.example/safe', '）'],
    ['corner-bracketed path', '「', 'https://allowed.example/safe', '」'],
  ])('removes paired wrappers from a URL with a %s', async (_name, opening, rawUrl, closing) => {
    const result = await urls({}, `Visit ${opening}${rawUrl}${closing} now`, {
      url_allow_list: [rawUrl],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['path', 'https://allowed.example/safe,'],
    ['query', 'https://allowed.example?token=allowed,'],
    ['fragment', 'https://allowed.example#allowed,'],
  ])('preserves trailing punctuation in a URL %s', async (_name, rawUrl) => {
    const scheme = rawUrl.slice(0, rawUrl.indexOf(':'));
    const result = await urls({}, rawUrl, {
      url_allow_list: [rawUrl],
      allowed_schemes: new Set([scheme]),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['file path', 'file:///tmp/report,', new Set(['file'])],
    ['generic empty-authority path', 'custom:///tmp/report,', new Set(['custom'])],
  ])('does not clean punctuation from a %s', async (_name, rawUrl, allowedSchemes) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: [rawUrl],
      allowed_schemes: allowedSchemes,
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['generic scheme', 'custom://allowed.example,', new Set(['custom'])],
    ['scheme-relative URL', '//allowed.example,', new Set(['http', 'https'])],
  ])('removes trailing prose punctuation from a %s', async (_name, rawUrl, allowedSchemes) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: allowedSchemes,
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl.slice(0, -1)]);
    expect(result.info?.allowed).toEqual([rawUrl.slice(0, -1)]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['query', 'https://allowed.example/safe?token=allowed\\]'],
    ['fragment', 'https://allowed.example/safe#allowed\\]'],
  ])('preserves trailing URL punctuation when validating an exact %s', async (_name, rawUrl) => {
    const allowedUrl =
      _name === 'query'
        ? 'https://allowed.example/safe?token=allowed'
        : 'https://allowed.example/safe#allowed';
    const parsedUrl = new URL(rawUrl);
    expect(_name === 'query' ? parsedUrl.search.slice(1) : parsedUrl.hash.slice(1)).not.toBe(
      allowedUrl.split(_name === 'query' ? '?' : '#', 2)[1]
    );

    const result = await urls({}, rawUrl, {
      url_allow_list: [allowedUrl],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each(['^', '|', '{', '}', '`', '"', '<', '>', '[', ']'])(
    'blocks userinfo bridged across the %j delimiter',
    async (delimiter) => {
      const rawUrl = `https://allowed.example${delimiter}@127.0.0.1/internal`;
      const parsedUrl = new URL(rawUrl);
      expect(parsedUrl.hostname).toBe('127.0.0.1');
      expect(parsedUrl.username).not.toBe('');

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example', '127.0.0.1'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['slashless special scheme', 'http:allowed.example^@127.0.0.1/internal', 'http'],
    ['generic authority scheme', 'gopher://allowed.example^@127.0.0.1/internal', 'gopher'],
  ])('blocks delimiter-bridged userinfo in a %s', async (_name, rawUrl, scheme) => {
    const parsedUrl = new URL(rawUrl);
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set([scheme]),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['forward slashes', '//'],
    ['backslashes', '\\\\'],
    ['mixed forward and backslashes', '/\\'],
    ['mixed back and forward slashes', '\\/'],
    ['three forward slashes', '///'],
  ])('blocks userinfo in a scheme-relative URL with %s', async (_name, prefix) => {
    const rawUrl = `${prefix}allowed.example@127.0.0.1/internal`;
    const parsedUrl = new URL(rawUrl, 'https://base.example/root');
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).toBe('allowed.example');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('does not confuse a scheme-relative host with the parser base hostname', async () => {
    const rawUrl = '//allowed.example@url-filter.invalid/internal';
    const parsedUrl = new URL(rawUrl, 'http://url-filter.invalid/');
    expect(parsedUrl.hostname).toBe('url-filter.invalid');
    expect(parsedUrl.username).toBe('allowed.example');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', 'url-filter.invalid'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['a numeric-leading final label', '//allowed.example@example.3com/internal', 'example.3com'],
    ['a single-label host', '//allowed.example@intranet/internal', 'intranet'],
  ])('blocks scheme-relative userinfo targeting %s', async (_name, rawUrl, hostname) => {
    const parsedUrl = new URL(rawUrl, 'https://base.example/root');
    expect(parsedUrl.hostname).toBe(hostname);
    expect(parsedUrl.username).toBe('allowed.example');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', hostname],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['SPACE', ' '],
    ['VT', '\v'],
    ['FF', '\f'],
    ['NBSP', '\u00a0'],
    ['EM SPACE', '\u2003'],
    ['LINE SEPARATOR', '\u2028'],
  ])('blocks explicit userinfo bridged by %s', async (_name, whitespace) => {
    const rawUrl = `https://allowed.example${whitespace}user@127.0.0.1/internal`;
    const parsedUrl = new URL(rawUrl);
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['forward slashes', '//'],
    ['backslashes', '\\\\'],
  ])('blocks scheme-relative userinfo bridged by whitespace with %s', async (_name, prefix) => {
    const rawUrl = `${prefix}allowed.example user@127.0.0.1/internal`;
    const parsedUrl = new URL(rawUrl, 'https://base.example/root');
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('validates the parsed host even when whitespace-bridged userinfo is permitted', async () => {
    const rawUrl = 'https://allowed.example user@127.0.0.1/internal';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('keeps an explicit URL separate from a following ordinary email address', async () => {
    const sourceUrl = 'https://evil.example';
    const bridgedUrl = `${sourceUrl} and email me@allowed.example`;
    const result = await urls({}, `Visit ${bridgedUrl}`, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([sourceUrl, bridgedUrl]);
    expect(result.info?.allowed).toEqual([bridgedUrl]);
    expect(result.info?.blocked).toEqual([sourceUrl]);
  });

  it('assigns a whitespace bridge to the closest explicit URL', async () => {
    const firstUrl = 'https://first.example/path';
    const bridgedUrl = 'https://allowed.example user@127.0.0.1/internal';
    const result = await urls({}, `${firstUrl} ${bridgedUrl}`, {
      url_allow_list: ['first.example', 'allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toHaveLength(2);
    expect(result.info?.detected).toEqual(expect.arrayContaining([firstUrl, bridgedUrl]));
    expect(result.info?.allowed).toEqual([firstUrl]);
    expect(result.info?.blocked).toEqual([bridgedUrl]);
  });

  it.each([
    ['SPACE', ' '],
    ['VT', '\v'],
    ['NBSP', '\u00a0'],
    ['IDEOGRAPHIC SPACE', '\u3000'],
  ])('blocks scheme-less userinfo bridged by %s', async (_name, whitespace) => {
    const rawUrl = `allowed.example${whitespace}user@127.0.0.1/internal`;
    const parsedUrl = new URL(`http://${rawUrl}`);
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('assigns a scheme-less whitespace bridge to the closest URL candidate', async () => {
    const firstUrl = 'first.example/path';
    const bridgedUrl = 'allowed.example user@127.0.0.1/internal';
    const result = await urls({}, `${firstUrl} ${bridgedUrl}`, {
      url_allow_list: ['first.example', 'allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toHaveLength(2);
    expect(result.info?.detected).toEqual(expect.arrayContaining([firstUrl, bridgedUrl]));
    expect(result.info?.allowed).toEqual([firstUrl]);
    expect(result.info?.blocked).toEqual([bridgedUrl]);
  });

  it('validates the scheme-less parsed host when whitespace-bridged userinfo is permitted', async () => {
    const rawUrl = 'allowed.example user@127.0.0.1/internal';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['an explicit URL', 'https://allowed.example user@safe evil@intranet'],
    ['a generic authority URL', 'gopher://allowed.example user@safe evil@intranet'],
    ['a scheme-relative URL', '//allowed.example user@safe evil@intranet'],
    ['a scheme-less URL', 'allowed.example user@safe evil@intranet'],
  ])('validates the host after the last userinfo separator in %s', async (_name, rawUrl) => {
    const parsedUrl = rawUrl.startsWith('//')
      ? new URL(rawUrl, 'https://base.example/root')
      : rawUrl.includes('://')
        ? new URL(rawUrl)
        : new URL(`http://${rawUrl}`);
    expect(parsedUrl.hostname).toBe('intranet');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', 'safe'],
      allowed_schemes: new Set(['https', 'gopher']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('keeps the original scheme while validating across an intermediate hostname', async () => {
    const rawUrl = 'https://allowed.example user@safe.example evil @intranet';
    expect(new URL(rawUrl).hostname).toBe('intranet');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', 'safe.example', 'http://intranet'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each(['/path', '?next=value', '#fragment'])(
    'does not let an at-sign in %s hide a later scheme-less URL',
    async (suffix) => {
      const firstUrl = `https://allowed.example user@safe.example${suffix}`;
      const secondUrl = 'other.example evil@intranet';
      const input = `${firstUrl} ${secondUrl}`;
      expect(new URL(input).hostname).toBe('safe.example');

      const result = await urls({}, input, {
        url_allow_list: ['allowed.example', 'safe.example', 'other.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([firstUrl, secondUrl]);
      expect(result.info?.allowed).toEqual([firstUrl]);
      expect(result.info?.blocked).toEqual([secondUrl]);
    }
  );

  it('detects a scheme-relative single-label host when it has a path', async () => {
    const rawUrl = '//intranet/internal';
    const result = await urls({}, rawUrl, {
      url_allow_list: ['intranet'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('blocks whitespace-bridged scheme-less userinfo after a numeric-leading label', async () => {
    const rawUrl = 'example.3com user@127.0.0.1/internal';
    const parsedUrl = new URL(`http://${rawUrl}`);
    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['example.3com', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    '//allowed.example/safe://segment',
    '//allowed.example/?next=https://other.example/path',
  ])('does not treat :// inside a scheme-relative URL as its scheme prefix', async (rawUrl) => {
    expect(new URL(rawUrl, 'https://base.example/root').hostname).toBe('allowed.example');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([rawUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['forward slashes separated by TAB', '/\t/'],
    ['forward slashes separated by LF', '/\n/'],
    ['backslashes separated by CR', '\\\r\\'],
    ['mixed slashes separated by CRLF', '/\r\n\\'],
  ])('blocks a control-obfuscated scheme-relative prefix with %s', async (_name, prefix) => {
    const rawUrl = `${prefix}allowed.example/safe`;
    const parsedUrl = new URL(rawUrl, 'https://base.example/root');
    expect(parsedUrl.hostname).toBe('allowed.example');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
    expect(result.info?.blocked_reasons?.[0]).toContain(
      'Ambiguous URL containing ASCII control characters'
    );
  });

  it.each([
    ['forward-slash scheme-relative URL', '//allowed.example/safe'],
    ['backslash scheme-relative URL', '\\\\allowed.example\\safe'],
    ['scheme-less URL with a path', 'allowed.example/safe'],
  ])('keeps a %s separate from an explicit URL on the next line', async (_name, firstUrl) => {
    const secondUrl = 'https://other.example/path';
    const result = await urls({}, `${firstUrl}\n${secondUrl}`, {
      url_allow_list: ['allowed.example', 'other.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toHaveLength(2);
    expect(result.info?.detected).toEqual(expect.arrayContaining([firstUrl, secondUrl]));
    expect(result.info?.allowed).toHaveLength(2);
    expect(result.info?.allowed).toEqual(expect.arrayContaining([firstUrl, secondUrl]));
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['forward slashes', '//allowed.example/safe^/../admin'],
    ['backslashes', '\\\\allowed.example\\safe^\\..\\admin'],
  ])('validates delimiter-bridged paths in scheme-relative URLs with %s', async (_name, rawUrl) => {
    expect(new URL(rawUrl, 'https://base.example/root').pathname).toBe('/admin');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['http://allowed.example/safe'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('does not treat an email address or a slash-prefixed word as a URL', async () => {
    const result = await urls({}, 'Contact user@allowed.example or read //todo.', {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['allowed.example']);
    expect(result.info?.allowed).toEqual(['allowed.example']);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['first.last+tag@allowed.example', 'allowed.example'],
    ['first.last@allowed.example', 'allowed.example'],
    ['first-last+tag@allowed.example', 'allowed.example'],
    ['<first.last+tag@allowed.example>', 'allowed.example'],
    ['用户.name@allowed.example', 'allowed.example'],
    ['δοκιμή.user@allowed.example', 'allowed.example'],
    ['u\u0308ser.name@allowed.example', 'allowed.example'],
    ['\u{10400}.name@allowed.example', 'allowed.example'],
    ['first.last+tag@allowed.example.', 'allowed.example'],
    ['first.last+tag@allowed.example?', 'allowed.example'],
    ['first.last+tag@例え.テスト', '例え.テスト'],
    ['<first.last+tag@例え.テスト>', '例え.テスト'],
    ['first.last+tag@例え。テスト', '例え。テスト'],
    ['first.last+tag@例え．テスト', '例え．テスト'],
    ['first.last+tag@例え｡テスト', '例え｡テスト'],
    ['first.last+tag@例え.テスト。', '例え.テスト'],
    ['first.last+tag@例え.テスト．', '例え.テスト'],
    ['first.last+tag@例え.テスト｡', '例え.テスト'],
    ['<first.last+tag@例え.テスト。>', '例え.テスト'],
    ['(first.last+tag@例え.テスト．)', '例え.テスト'],
  ])('does not treat the local part of %s as a URL', async (email, host) => {
    const result = await urls({}, `Contact ${email} for help.`, {
      url_allow_list: ['allowed.example', '例え.テスト'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([host]);
    expect(result.info?.allowed).toEqual([host]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    'first.last+tag@allowed.example/path',
    'first.last+tag@allowed.example:444',
    'first.last+tag@allowed.example?q=1',
    'first.last+tag@allowed.example#fragment',
    '用户.name@allowed.example/path',
    'first.last+tag@例え.テスト/path',
    'first.last+tag@例え.テスト:444',
  ])('keeps URL-like email syntax in userinfo validation for %s', async (rawUrl) => {
    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example', '例え.テスト'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toContain(rawUrl);
  });

  it.each([
    ['IPv4', '127.0.0.1'],
    ['decimal IPv4', '2130706433'],
    ['hexadecimal IPv4', '0x7f000001'],
    ['octal IPv4', '0177.0.0.1'],
    ['short IPv4', '127.1'],
    ['localhost', 'localhost'],
    ['IPv6', '[::1]'],
    ['numeric-leading final label', 'example.3com'],
  ])('keeps the %s target in userinfo validation', async (_name, host) => {
    const rawUrl = `first.last+tag@${host}`;
    const parsedUrl = new URL(`http://${rawUrl}`);
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, rawUrl, {
      url_allow_list: [host, parsedUrl.hostname],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toContain(rawUrl);
    expect(result.info?.blocked).toContain(rawUrl);
    expect(result.info?.blocked_reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Contains userinfo')])
    );
  });

  it.each(['^', '|', '{', '}', '`', '"', '<', '>', '[', ']'])(
    'validates a path bridged across the %j delimiter',
    async (delimiter) => {
      const rawUrl = `https://allowed.example/safe${delimiter}/../admin`;
      expect(new URL(rawUrl).pathname).toBe('/admin');

      const result = await urls({}, rawUrl, {
        url_allow_list: ['https://allowed.example/safe'],
        allowed_schemes: new Set(['https']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it('blocks an obfuscated scheme after a Markdown underscore', async () => {
    const rawUrl = 'htt\tp://allowed.com/path';
    const result = await urls({}, `_${rawUrl}`, {
      url_allow_list: ['allowed.com'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(new URL(rawUrl).protocol).toBe('http:');
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('blocks a dotted control-obfuscated scheme before an explicit URL', async () => {
    const rawUrl = 'evil\nhttps://allowed.example/path';
    const result = await urls({}, `Visit .${rawUrl}`, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(new URL(rawUrl).protocol).toBe('evilhttps:');
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('does not detect a URL scheme inside another scheme-like token', async () => {
    const result = await urls({}, 'metadata:payload myjavascript:payload', defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('does not treat a scheme-like prose label as an empty hostless URL', async () => {
    const result = await urls({}, 'data: value', defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('detects a hostless URL after a Markdown underscore', async () => {
    const rawUrl = 'javascript:payload';
    const result = await urls({}, `_${rawUrl}`, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('keeps explicit URLs on consecutive lines separate for %s', async (_name, lineBreak) => {
    const firstUrl = 'https://allowed.example';
    const secondUrl = 'https://other.example';
    for (const indentation of ['', '\t', '\u00a0', '\u2003']) {
      const result = await urls({}, `${firstUrl}${lineBreak}${indentation}${secondUrl}`, {
        url_allow_list: ['allowed.example', 'other.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered, JSON.stringify(indentation)).toBe(false);
      expect(result.info?.detected, JSON.stringify(indentation)).toEqual([firstUrl, secondUrl]);
      expect(result.info?.allowed, JSON.stringify(indentation)).toEqual([firstUrl, secondUrl]);
      expect(result.info?.blocked, JSON.stringify(indentation)).toEqual([]);
    }
  });

  it.each(['\n', '\r\n', '\r'])(
    'blocks a dotted prefix joined to an explicit authority URL across %j',
    async (lineBreak) => {
      const rawUrl = `evil.com${lineBreak}https://allowed.example/path`;
      expect(new URL(rawUrl).protocol).toBe('evil.comhttps:');

      const result = await urls({}, rawUrl, {
        url_allow_list: ['evil.com', 'allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each([
    ['data', 'data:text/plain,a', 'data:text/plain,b'],
    ['javascript', 'javascript:void(0)', 'javascript:void(1)'],
    ['vbscript', 'vbscript:void(0)', 'vbscript:void(1)'],
  ])('keeps consecutive %s URLs separate', async (scheme, firstUrl, secondUrl) => {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      for (const indentation of ['', '\t']) {
        const input = `${firstUrl}${lineBreak}${indentation}${secondUrl}`;
        const result = await urls({}, input, {
          url_allow_list: [],
          allowed_schemes: new Set([scheme]),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(input)).toBe(false);
        expect(result.info?.detected, JSON.stringify(input)).toEqual([firstUrl, secondUrl]);
        expect(result.info?.allowed, JSON.stringify(input)).toEqual([firstUrl, secondUrl]);
        expect(result.info?.blocked, JSON.stringify(input)).toEqual([]);
      }
    }
  });

  it.each(['data', 'javascript', 'vbscript'])(
    'blocks an authority URL followed by an allowed %s URL when control removal changes the authority',
    async (scheme) => {
      for (const lineBreak of ['\n', '\r\n', '\r']) {
        const rawUrl = `https://allowed.co${lineBreak}${scheme}:443`;
        const parsedUrl = new URL(rawUrl);

        expect(parsedUrl.hostname).toBe(`allowed.co${scheme}`);

        const result = await urls({}, rawUrl, {
          url_allow_list: ['allowed.co'],
          allowed_schemes: new Set(['https', scheme]),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each([
    ['domain suffix', 'allowed.co\nm/path', 'allowed.com'],
    ['IPv4 segment', '127.0.0.\n1/path', '127.0.0.1'],
    ['port digits', 'allowed.example:4\n43/path', 'allowed.example'],
    ['query value', 'allowed.example?x=\n1', 'allowed.example'],
  ])(
    'blocks a control-bearing scheme-less URL across %s',
    async (_name, rawUrl, expectedHostname) => {
      const parsedUrl = new URL(`http://${rawUrl}`);

      expect(parsedUrl.hostname).toBe(expectedHostname);

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.co', '127.0.0.1', 'allowed.example'],
        allowed_schemes: new Set(['http']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it('keeps a trailing control outside a scheme-less URL candidate', async () => {
    const result = await urls({}, 'allowed.example\n', {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['http']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['allowed.example']);
    expect(result.info?.allowed).toEqual(['allowed.example']);
    expect(result.info?.blocked).toEqual([]);
  });

  it('blocks every parser-accepted internal control in scheme-less URL forms', async () => {
    const baseUrls = [
      'allowed.example/path?x=1#details',
      'allowed.example?x=1#details',
      'sub.allowed.example:444/path',
      '127.0.0.1:8080/internal',
      'www.allowed.example/path',
    ];
    const controls = ['\t', '\n', '\r', '\r\n', '\t\n', '\n\t', '\r\t'];
    const config = {
      url_allow_list: [
        'allowed.example',
        'sub.allowed.example',
        '127.0.0.1',
        'www.allowed.example',
      ],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    };

    for (const baseUrl of baseUrls) {
      for (let position = 1; position < baseUrl.length; position += 1) {
        for (const control of controls) {
          const rawUrl = `${baseUrl.slice(0, position)}${control}${baseUrl.slice(position)}`;
          try {
            new URL(`http://${rawUrl}`);
          } catch {
            continue;
          }

          const result = await urls({}, `_${rawUrl}`, config);

          expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
          expect(
            result.info?.blocked?.some((candidate) => candidate.includes(rawUrl)),
            JSON.stringify(rawUrl)
          ).toBe(true);
        }
      }
    }
  });

  it('blocks every parser-accepted internal control in special scheme-less hosts', async () => {
    const baseUrls = [
      '2130706433/internal',
      '0177.0.0.1/internal',
      '017700000001/internal',
      '0x7f000001/internal',
      '2130706433./internal',
      '0x7f000001./internal',
      '0x7f.1/internal',
      '127.1/internal',
      '127.0.1/internal',
      '0300.0250.0001.0001/internal',
      '0x7f.0.0.1/internal',
      '127.0000001/internal',
      '127.0.0.1./internal',
      '１２７。０。０。１/internal',
      'example.xn--p1ai/internal',
      '例え.テスト/internal',
      'example。com/internal',
      'example．com/internal',
      'example｡com/internal',
      '%65xample.com/internal',
      'allowed%2eexample/internal',
      'example%E3%80%82com/internal',
      'example%EF%BC%8Ecom/internal',
      'example%EF%BD%A1com/internal',
      '127%2e0%2e0%2e1/internal',
      '127%EF%BC%8E0%EF%BC%8E0%EF%BC%8E1/internal',
      '%31%32%37%2e0%2e0%2e1/internal',
      '%31%32%37。0%2e%30%E3%80%821/internal',
      '%32%31%33%30%37%30%36%34%33%33/internal',
      '0x7f%2e1/internal',
      '0%78%37f｡%31/internal',
      'localhost%2e/internal',
      'localhost%EF%BC%8E/internal',
      'local%68ost/internal',
      '%6c%6f%63%61%6c%68%6f%73%74/internal',
      'foo_bar.example/internal',
      '[::1]/internal',
      'localhost/internal',
      'localhost./internal',
      'ｌｏｃａｌｈｏｓｔ/internal',
      'ℓocalhost/internal',
      '@example.com/internal',
      '@2130706433/internal',
      '@localhost/internal',
      '@[::1]/internal',
      'user:pass@2130706433/internal',
      'first@second@2130706433/internal',
      'user:pass@0x7f000001/internal',
      'user:pass@127.1/internal',
      'first@second@example.com/internal',
      'user:pass@_service.example/internal',
      'user:pass@allowed%2eexample/internal',
      'user:pass@example%E3%80%82com/internal',
      'user:pass@local%68ost/internal',
      'user:pass@例え.テスト/internal',
      'user:pass@[::1]/internal',
      'user:pass@localhost/internal',
      'user:pass@ｌｏｃａｌｈｏｓｔ/internal',
    ];
    const controls = ['\t', '\n', '\r', '\r\n'];
    const config = {
      url_allow_list: [
        '127.0.0.1',
        '192.168.1.1',
        'example.xn--p1ai',
        '例え.テスト',
        'example.com',
        '[::1]',
        'localhost',
        'localhost.',
      ],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    };

    for (const baseUrl of baseUrls) {
      for (let position = 1; position < baseUrl.length; position += 1) {
        for (const control of controls) {
          const rawUrl = `${baseUrl.slice(0, position)}${control}${baseUrl.slice(position)}`;
          try {
            new URL(`http://${rawUrl}`);
          } catch {
            continue;
          }

          for (const input of [
            rawUrl,
            `_${rawUrl}`,
            `<${rawUrl}>`,
            `[${rawUrl}]`,
            `(${rawUrl})`,
            `Visit ${rawUrl} today`,
          ]) {
            const result = await urls({}, input, config);

            expect(result.tripwireTriggered, JSON.stringify(input)).toBe(true);
            expect(
              result.info?.blocked?.some((candidate) => candidate.includes(rawUrl)),
              JSON.stringify(input)
            ).toBe(true);
          }
        }
      }
    }
  });

  it('blocks control-bearing scheme-less URLs inside markup delimiters', async () => {
    const baseUrl = 'allowed.example/path';
    const config = {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    };

    for (let position = 1; position < baseUrl.length; position += 1) {
      for (const control of ['\t', '\n', '\r']) {
        const rawUrl = `${baseUrl.slice(0, position)}${control}${baseUrl.slice(position)}`;
        try {
          new URL(`http://${rawUrl}`);
        } catch {
          continue;
        }

        for (const [opening, closing] of [
          ['<', '>'],
          ['[', ']'],
        ]) {
          const result = await urls({}, `${opening}${rawUrl}${closing}`, config);

          expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
          expect(
            result.info?.blocked?.some((candidate) => candidate.includes(rawUrl)),
            JSON.stringify(rawUrl)
          ).toBe(true);
        }
      }
    }
  });

  it.each([
    ['IPv4', '127\n.0.0.1/path'],
    ['localhost', 'local\nhost/path'],
    ['IPv6', '[::\n1]/path'],
  ])('blocks a control-bearing scheme-less %s after punctuation', async (_name, rawUrl) => {
    expect(new URL(`http://${rawUrl}`).hostname).toBeTruthy();

    for (const punctuation of ['-', '.']) {
      const result = await urls({}, `Visit ${punctuation}${rawUrl} today`, {
        url_allow_list: ['127.0.0.1', 'localhost', '[::1]'],
        allowed_schemes: new Set(['http']),
        block_userinfo: false,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered, punctuation).toBe(true);
      expect(result.info?.detected, punctuation).toEqual([rawUrl]);
      expect(result.info?.allowed, punctuation).toEqual([]);
      expect(result.info?.blocked, punctuation).toEqual([rawUrl]);
    }
  });

  it('blocks a whitespace-bridged scheme-less userinfo differential', async () => {
    const rawUrl = 'allowed.example \n junk@2130706433';
    const parsedUrl = new URL(`http://${rawUrl}`);

    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, `Visit ${rawUrl} today`, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('blocks an entire scheme-less URL with control-bearing userinfo', async () => {
    const rawUrl = 'user \n @2130706433';
    const parsedUrl = new URL(`http://${rawUrl}`);

    expect(parsedUrl.hostname).toBe('127.0.0.1');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['user'],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['forward slashes', '//'],
    ['backslashes', '\\\\'],
  ])('blocks control-bearing userinfo after scheme-relative %s', async (_name, prefix) => {
    const schemelessUrl = 'us\ner@2130706433/internal';
    const rawUrl = `${prefix}${schemelessUrl}`;

    expect(new URL(rawUrl, 'https://example.com/base').hostname).toBe('127.0.0.1');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toHaveLength(1);
    expect(result.info?.blocked?.[0]).toContain(schemelessUrl);
    expect(result.info?.blocked_reasons?.[0]).toContain(
      'Ambiguous URL containing ASCII control characters'
    );
  });

  it.each([
    ['percent-encoded IPv4', '%31%32\n%37%2e0%2e0%2e1'],
    ['percent-encoded localhost', 'local\n%68ost'],
    ['fullwidth IPv4', '１２\n７。０。０。１'],
    ['fullwidth localhost', 'ｌｏ\nｃａｌｈｏｓｔ'],
    ['empty userinfo', '@\nlocalhost'],
  ])('blocks an entire control-bearing %s without a URL suffix', async (_name, rawUrl) => {
    const parsedUrl = new URL(`http://${rawUrl}`);

    expect(['127.0.0.1', 'localhost']).toContain(parsedUrl.hostname);

    const result = await urls({}, rawUrl, {
      url_allow_list: [parsedUrl.hostname],
      allowed_schemes: new Set(['http']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each(['\t', '\n', '\r'])(
    'blocks control-bearing userinfo parser differentials for %j',
    async (control) => {
      const rawUrl = `http://allowed.example${control}@2130706433/internal/credentials`;
      const parsed = new URL(rawUrl);

      expect(parsed.username).toBe('allowed.example');
      expect(parsed.hostname).toBe('127.0.0.1');

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['http']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['\t', '\n', '\r'])(
    'blocks controls throughout hierarchical URL syntax for %j',
    async (control) => {
      const cases = [
        {
          rawUrl: `http:${control}//2130706433/internal`,
          expectedUrl: 'http://127.0.0.1/internal',
          config: defaultUrlConfig,
        },
        {
          rawUrl: `http:/${control}/2130706433/internal`,
          expectedUrl: 'http://127.0.0.1/internal',
          config: defaultUrlConfig,
        },
        {
          rawUrl: `http://${control}2130706433/internal`,
          expectedUrl: 'http://127.0.0.1/internal',
          config: defaultUrlConfig,
        },
        {
          rawUrl: `https://allowed${control}.com/internal`,
          expectedUrl: 'https://allowed.com/internal',
          config: {
            url_allow_list: ['allowed'],
            allowed_schemes: new Set(['https']),
            block_userinfo: true,
            allow_subdomains: false,
          },
        },
        {
          rawUrl: `https://allowed.example/safe?role=user${control}&role=admin`,
          expectedUrl: 'https://allowed.example/safe?role=user&role=admin',
          config: {
            url_allow_list: ['https://allowed.example/safe?role=user'],
            allowed_schemes: new Set(['https']),
            block_userinfo: true,
            allow_subdomains: false,
          },
        },
        {
          rawUrl: `https://allowed.example/safe${control}evil`,
          expectedUrl: 'https://allowed.example/safeevil',
          config: {
            url_allow_list: ['https://allowed.example/safe'],
            allowed_schemes: new Set(['https']),
            block_userinfo: true,
            allow_subdomains: false,
          },
        },
      ];

      for (const { rawUrl, expectedUrl, config } of cases) {
        expect(new URL(rawUrl).href).toBe(expectedUrl);

        const result = await urls({}, rawUrl, config);

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it('blocks parser-accepted controls at every internal URL position', async () => {
    const baseUrls = [
      'http://2130706433/internal/resource',
      'https://allowed.example:444/path/to/resource?role=user#details',
      'https://user:pass@allowed.example/internal/resource',
      'https://[::1]:444/internal/resource',
      'https://例え.テスト/internal/resource',
      'https://allowed.example/path%2Fsegment',
      'ftp://allowed.example:2121/internal/resource',
      'data:text/plain,payload',
      'javascript:payload',
      'vbscript:payload',
    ];

    for (const baseUrl of baseUrls) {
      for (const control of ['\t', '\n', '\r\n', '\r', '\t\n', '\n\t', '\r\t']) {
        for (let index = 1; index < baseUrl.length; index += 1) {
          const rawUrl = `${baseUrl.slice(0, index)}${control}${baseUrl.slice(index)}`;
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(rawUrl);
          } catch {
            continue;
          }

          const scheme = parsedUrl.protocol.replace(/:$/, '');
          const result = await urls({}, `Visit ${rawUrl} today`, {
            url_allow_list: parsedUrl.hostname ? [parsedUrl.hostname] : [],
            allowed_schemes: new Set([scheme]),
            block_userinfo: false,
            allow_subdomains: false,
          });

          expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
          expect(result.info?.blocked, JSON.stringify(rawUrl)).toContain(rawUrl);
        }
      }
    }
  });

  it.each(['data', 'javascript', 'vbscript'])(
    'blocks trailing controls on a scheme-only %s URL',
    async (scheme) => {
      for (const control of ['\t', '\n', '\r\n', '\r', '\t\n', '\n\t', '\r\t']) {
        const rawUrl = `${scheme}:${control}`;

        expect(new URL(rawUrl).protocol).toBe(`${scheme}:`);

        const result = await urls({}, rawUrl, defaultUrlConfig);

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each(['data', 'javascript', 'vbscript'])(
    'validates a scheme-only %s URL before a consecutive explicit URL',
    async (scheme) => {
      for (const lineBreak of ['\n', '\r\n', '\r']) {
        const secondUrl = 'https://allowed.example';
        const input = `${scheme}:${lineBreak}${secondUrl}`;
        const result = await urls({}, input, {
          url_allow_list: ['allowed.example'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(input)).toBe(true);
        expect(result.info?.detected, JSON.stringify(input)).toHaveLength(2);
        expect(result.info?.detected, JSON.stringify(input)).toEqual(
          expect.arrayContaining([scheme + ':', secondUrl])
        );
        expect(result.info?.allowed, JSON.stringify(input)).toEqual([secondUrl]);
        expect(result.info?.blocked, JSON.stringify(input)).toEqual([scheme + ':']);
      }
    }
  );

  it.each(['\t', '\n', '\r'])(
    'blocks controls in special URLs with zero to two authority separators for %j',
    async (control) => {
      for (const separators of ['', '/', '\\', '//', '/\\', '\\/', '\\\\']) {
        const rawUrls = [
          `htt${control}p:${separators}2130706433/internal`,
          `http:${control}${separators}2130706433/internal`,
        ];

        for (const rawUrl of rawUrls) {
          expect(new URL(rawUrl).href).toBe('http://127.0.0.1/internal');

          const result = await urls({}, rawUrl, defaultUrlConfig);

          expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
          expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
          expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
          expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        }
      }
    }
  );

  it.each(['<', '>', '"', '|', '^', '`', '{', '}', '[', ']'])(
    'blocks whole-input differentials before parser-accepted path character %j',
    async (pathCharacter) => {
      const rawUrl = `https://allowed.co\nm/path${pathCharacter}value`;

      expect(new URL(rawUrl).hostname).toBe('allowed.com');

      const result = await urls({}, rawUrl, {
        url_allow_list: ['allowed.co'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['<', '>', '"', '|', '^', '`', '{', '}', '[', ']'])(
    'blocks embedded differentials hidden behind candidate boundary character %j',
    async (boundaryCharacter) => {
      for (const control of ['\n', '\r']) {
        const rawUrl = `https://allowed.example${control}${boundaryCharacter}junk@2130706433`;
        const parsedUrl = new URL(rawUrl);

        expect(parsedUrl.hostname).toBe('127.0.0.1');
        expect(parsedUrl.username).not.toBe('');

        const result = await urls({}, `Visit ${rawUrl} today`, {
          url_allow_list: ['allowed.example'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each([
    ['SPACE', ' '],
    ['VT', '\v'],
    ['FF', '\f'],
  ])('blocks embedded differentials hidden behind %s whitespace', async (_name, separator) => {
    for (const control of ['\n', '\r']) {
      for (const gap of [`${control}${separator}`, `${separator}${control}${separator}`]) {
        const rawUrl = `https://allowed.example${gap}junk@2130706433`;
        const parsedUrl = new URL(rawUrl);

        expect(parsedUrl.hostname).toBe('127.0.0.1');
        expect(parsedUrl.username).not.toBe('');

        const result = await urls({}, `Visit ${rawUrl} today`, {
          url_allow_list: ['allowed.example'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  });

  it.each(['\n', '\r'])(
    'blocks embedded authority differentials with later URL syntax for %j',
    async (control) => {
      for (const suffix of ['m', 'm/path', 'm\\path', 'm?query', 'm#fragment']) {
        const rawUrl = `https://allowed.co${control}${suffix}`;

        expect(new URL(rawUrl).hostname).not.toBe('allowed.co');

        const result = await urls({}, `Visit ${rawUrl} today`, {
          url_allow_list: ['allowed.co'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each(['\n', '\r'])(
    'blocks capitalized suffixes that change the hostname for %j',
    async (control) => {
      const rawUrl = `https://allowed.c${control}Om`;

      expect(new URL(rawUrl).hostname).toBe('allowed.com');

      const result = await urls({}, `Visit ${rawUrl} today`, {
        url_allow_list: ['allowed.c'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['\n', '\r\n', '\r'])(
    'blocks controls that change an explicit port for %j',
    async (control) => {
      const rawUrl = `https://127.0.0.1:4${control}43`;
      const parsedUrl = new URL(rawUrl);

      expect(parsedUrl.hostname).toBe('127.0.0.1');
      expect(parsedUrl.port).toBe('');

      const result = await urls({}, `Visit ${rawUrl} today`, {
        url_allow_list: ['https://127.0.0.1:4'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['\n', '\r'])(
    'blocks embedded email and mention suffixes that normalize to local hosts for %j',
    async (control) => {
      for (const suffix of ['user@2130706433', '@2130706433', 'user@127.0.0.1', 'user@localhost']) {
        const rawUrl = `https://allowed.co${control}${suffix}`;
        const normalizedHost = new URL(rawUrl).hostname;

        expect(normalizedHost === 'localhost' || normalizedHost === '127.0.0.1').toBe(true);

        const result = await urls({}, `Visit ${rawUrl} today`, {
          url_allow_list: ['allowed.co'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each(['\n', '\r'])(
    'blocks embedded mention and email suffixes parsed as URL authority for %j',
    async (control) => {
      for (const suffix of ['@metadata', 'user@allowed.co']) {
        const rawUrl = `https://allowed.co${control}${suffix}`;
        const parsedUrl = new URL(rawUrl);

        expect(parsedUrl.username).not.toBe('');

        const result = await urls({}, `Visit ${rawUrl} today`, {
          url_allow_list: ['allowed.co'],
          allowed_schemes: new Set(['https']),
          block_userinfo: true,
          allow_subdomains: false,
        });

        expect(result.tripwireTriggered, JSON.stringify(rawUrl)).toBe(true);
        expect(result.info?.detected, JSON.stringify(rawUrl)).toEqual([rawUrl]);
        expect(result.info?.allowed, JSON.stringify(rawUrl)).toEqual([]);
        expect(result.info?.blocked, JSON.stringify(rawUrl)).toEqual([rawUrl]);
      }
    }
  );

  it.each(['\n', '\r'])(
    'blocks embedded line breaks that change an allowlisted path for %j',
    async (control) => {
      const rawUrl = `https://allowed.example/safe${control}@metadata`;

      expect(new URL(rawUrl).pathname).toBe('/safe@metadata');

      const result = await urls({}, `Visit ${rawUrl} today`, {
        url_allow_list: ['https://allowed.example/safe'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it('blocks a tab that extends an otherwise complete authority', async () => {
    const rawUrl = 'https://allowed.example\tevil/internal';

    expect(new URL(rawUrl).href).toBe('https://allowed.exampleevil/internal');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])(
    'fails closed when a bare %s can extend an otherwise complete authority',
    async (_name, lineBreak) => {
      const rawUrl = `https://example.com${lineBreak}Then`;

      expect(new URL(rawUrl).hostname).toBe('example.comthen');

      const result = await urls({}, `Visit ${rawUrl} continue`, {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.detected).toEqual([rawUrl]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([rawUrl]);
    }
  );

  it.each(['\t', '\n', '\r\n', '\r'])(
    'blocks a control immediately before closing prose punctuation for %j',
    async (control) => {
      const rawUrl = `https://allowed.example/path${control})`;

      expect(new URL(rawUrl).pathname).toBe('/path)');

      const result = await urls({}, `Visit ${rawUrl} today`, {
        url_allow_list: ['allowed.example'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toHaveLength(1);
      expect(result.info?.blocked[0]).toContain(control);
    }
  );

  it('keeps multiline text when whitespace separates the URL from the next line', async () => {
    const result = await urls(
      {},
      'Visit https://example.com \nThen continue with the explanation.',
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      }
    );

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['https://example.com']);
    expect(result.info?.allowed).toEqual(['https://example.com']);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    'Version 1.2\nThen continue with the release notes.',
    'The measured value is 3.14\r\nNext record follows.',
  ])('does not treat multiline decimal prose as a scheme-less URL', async (input) => {
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles long percent-encoded prose without treating it as a URL', async () => {
    const input = `Value ${'%31'.repeat(2_000)}\nThen decode it`;
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    ['ASCII dots', '.', false],
    ['Unicode dots', '\u3002', false],
    ['percent-encoded ASCII dots', '%2e', true],
    ['percent-encoded Unicode dots', '%ef%bc%8e', true],
  ])('handles a long separator-only token made of %s', async (_name, separator, detected) => {
    const input = `${separator.repeat(24_000)}\n`;
    const result = await urls({}, input, defaultUrlConfig);

    const token = input.trim();
    expect(result.tripwireTriggered).toBe(detected);
    expect(result.info?.detected).toEqual(detected ? [token] : []);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual(detected ? [token] : []);
  });

  it('handles a long control-separated non-URL token without excessive backtracking', async () => {
    const input = `${'a\t'.repeat(10_000)}payload`;
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles long scheme-character tokens without quadratic generic-scheme scanning', async () => {
    for (const suffix of ['', ':', ':x', '://', '\t']) {
      const input = `${'a.'.repeat(20_000)}${suffix}`;
      const result = await urls({}, input, defaultUrlConfig);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([]);
    }

    const genericUrl = `${'a.'.repeat(20_000)}://allowed.example/path`;
    const result = await urls({}, genericUrl, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([genericUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([genericUrl]);

    const bridgedInput = `${'a.'.repeat(20_000)} user@host`;
    const bridgedResult = await urls({}, bridgedInput, defaultUrlConfig);

    expect(bridgedResult.tripwireTriggered).toBe(true);
    expect(bridgedResult.info?.detected).toHaveLength(1);
    expect(bridgedResult.info?.allowed).toEqual([]);
    expect(bridgedResult.info?.blocked).toHaveLength(1);
  });

  it('handles a long excluded-delimiter path without excessive backtracking', async () => {
    const input = `https://allowed.example/${'^'.repeat(20_000)}tail`;
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles a long unmatched paired-wrapper prefix without quadratic scanning', async () => {
    for (const prefix of ['{'.repeat(20_000), '{('.repeat(10_000), '*'.repeat(20_000)]) {
      const result = await urls({}, `${prefix}prose}`, defaultUrlConfig);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([]);
      expect(result.info?.allowed).toEqual([]);
      expect(result.info?.blocked).toEqual([]);
    }
  });

  it('handles many separated unmatched paired wrappers without quadratic scanning', async () => {
    const input = '(a'.repeat(200_000);
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many paired openers with distant closers without quadratic scanning', async () => {
    const input = `${'(a'.repeat(64_000)}${')'.repeat(64_000)}`;
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many matched shared delimiters without quadratic scanning', async () => {
    const input = '|a'.repeat(320_000);
    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many whitespace-separated URLs without quadratic bridge scanning', async () => {
    const input = 'https://allowed.example '.repeat(2_000);
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['https://allowed.example']);
    expect(result.info?.allowed).toEqual(['https://allowed.example']);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many assignment-like tokens without rescanning prior text', async () => {
    const input = 'a=x.com '.repeat(32_000);
    const result = await urls({}, input, {
      url_allow_list: ['x.com'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['x.com']);
    expect(result.info?.allowed).toEqual(['x.com']);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many scheme-less bridge owners without quadratic scanning', async () => {
    const bridgedUrl = 'allowed.example user@127.0.0.1/internal';
    const input = `${'allowed.example '.repeat(2_000)}${bridgedUrl}`;
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example', '127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toHaveLength(2);
    expect(result.info?.detected).toEqual(expect.arrayContaining([bridgedUrl, 'allowed.example']));
    expect(result.info?.allowed).toEqual(['allowed.example']);
    expect(result.info?.blocked).toEqual([bridgedUrl]);
  });

  it('handles many userinfo separators without repeated prefix parsing', async () => {
    const input = `https://allowed.example ${'user@safe '.repeat(2_000)}evil@intranet`;
    const result = await urls({}, input, {
      url_allow_list: ['allowed.example', 'safe'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([input]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([input]);
  });

  it('handles many ordinary IDN email addresses without repeated range scanning', async () => {
    const input = '用户.name@例え.テスト '.repeat(2_000);
    const result = await urls({}, input, {
      url_allow_list: ['例え.テスト'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual(['例え.テスト']);
    expect(result.info?.allowed).toEqual(['例え.テスト']);
    expect(result.info?.blocked).toEqual([]);
  });

  it('handles many special-host email candidates without repeated range scanning', async () => {
    const rawUrl = 'first.last+tag@127.0.0.1';
    const input = `${rawUrl} `.repeat(2_000);
    const result = await urls({}, input, {
      url_allow_list: ['127.0.0.1'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('handles an oversized invalid percent-encoded host without excessive backtracking', async () => {
    const input = `${'%31'.repeat(20_000)}\n/path`;
    expect(() => new URL(`http://${input}`)).toThrow();

    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('blocks an oversized parser-accepted IDNA host without excessive backtracking', async () => {
    const input = `${'ℓ'.repeat(20_000)}.com\n/path`;
    expect(new URL(`http://${input}`).hostname).toMatch(/\.com$/);

    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([input]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([input]);
  });

  it('handles many IDNA labels without quadratic excluded-delimiter scanning', async () => {
    const rawUrl = `${'a。'.repeat(8_000)}a/path`;
    const input = `${rawUrl} note ^ marker`;
    expect(new URL(`http://${rawUrl}`).hostname).toContain('.');

    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('handles long IDNA punctuation labels without repeated suffix scanning', async () => {
    const hostname = `${'name·'.repeat(8_000)}example.test`;
    const input = `${hostname}^note/path`;

    const result = await urls({}, input, defaultUrlConfig);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([hostname]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([hostname]);
  });

  it.each([
    ['SPACE', ' '],
    ['VT', '\v'],
    ['FF', '\f'],
    ['NBSP', '\u00a0'],
    ['OGHAM SPACE MARK', '\u1680'],
    ['EM SPACE', '\u2003'],
    ['LINE SEPARATOR', '\u2028'],
    ['PARAGRAPH SEPARATOR', '\u2029'],
    ['NARROW NBSP', '\u202f'],
    ['MEDIUM MATHEMATICAL SPACE', '\u205f'],
    ['IDEOGRAPHIC SPACE', '\u3000'],
    ['BOM', '\ufeff'],
  ])('treats %s after a line break as a hard URL boundary', async (_name, separator) => {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      const input = `Visit https://example.com${lineBreak}${separator}Then continue`;
      const result = await urls({}, input, {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        block_userinfo: true,
        allow_subdomains: false,
      });

      expect(result.tripwireTriggered, JSON.stringify(input)).toBe(false);
      expect(result.info?.detected, JSON.stringify(input)).toEqual(['https://example.com']);
      expect(result.info?.allowed, JSON.stringify(input)).toEqual(['https://example.com']);
      expect(result.info?.blocked, JSON.stringify(input)).toEqual([]);
    }
  });

  it.each([
    ['an at-mention', 'Visit https://example.com \n@example can help', ['example.com']],
    [
      'an email address',
      'Visit https://example.com \nuser@example.org can help',
      ['example.com', 'example.org'],
    ],
  ])('blocks whitespace-separated %s when WHATWG can join it', async (_name, text, allowList) => {
    const result = await urls({}, text, {
      url_allow_list: allowList,
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toHaveLength(1);
  });

  it('bridges to the first at-sign after the control', async () => {
    const rawUrl = 'https://allowed.example user@example.com \n junk@2130706433';
    const parsedUrl = new URL(rawUrl);

    expect(parsedUrl.hostname).toBe('127.0.0.1');
    expect(parsedUrl.username).not.toBe('');

    const result = await urls({}, `Visit ${rawUrl} today`, {
      url_allow_list: ['allowed.example', 'example.com'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
    expect(result.info?.blocked_reasons).toContain(
      `${rawUrl}: Ambiguous URL containing ASCII control characters`
    );
  });

  it.each(['\n', '\r'])('blocks scheme-like userinfo after whitespace for %j', async (control) => {
    const rawUrl = `https://allowed.example${control} https:foo@2130706433`;

    expect(new URL(rawUrl).href).toBe('https://allowed.example%20https:foo@127.0.0.1/');

    const result = await urls({}, `Visit ${rawUrl} today`, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('uses the closest scheme before a control as the userinfo bridge', async () => {
    const rawUrl = 'https://allowed.example\n https:foo@2130706433';
    const input = `Items: ${'data:x '.repeat(256)}${rawUrl} today`;

    const result = await urls({}, input, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['data', 'https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('preserves an explicit authority boundary after a slashless scheme token', async () => {
    const firstUrl = 'https://allowed.example';
    const secondUrl = 'https://user@other.example';
    const input = `${firstUrl}\n https:note ${secondUrl}`;

    const result = await urls({}, input, {
      url_allow_list: ['allowed.example', 'other.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([firstUrl, secondUrl]);
    expect(result.info?.allowed).toEqual([firstUrl, secondUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it('keeps an explicit authority URL after a line break separate', async () => {
    const firstUrl = 'https://allowed.example';
    const secondUrl = 'https://user@other.example';
    const result = await urls({}, `Visit ${firstUrl}\n ${secondUrl} today`, {
      url_allow_list: ['allowed.example', 'other.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: false,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected).toEqual([firstUrl, secondUrl]);
    expect(result.info?.allowed).toEqual([firstUrl, secondUrl]);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each(['\n', '\r'])('blocks a whole-input userinfo differential after %j', async (control) => {
    const rawUrl = `https://allowed.example${control}@2130706433`;

    expect(new URL(rawUrl).href).toBe('https://allowed.example@127.0.0.1/');

    const result = await urls({}, rawUrl, {
      url_allow_list: ['allowed.example'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toEqual([rawUrl]);
    expect(result.info?.allowed).toEqual([]);
    expect(result.info?.blocked).toEqual([rawUrl]);
  });

  it('classifies normal and ambiguous URLs independently', async () => {
    const ambiguousUrl = 'htt\tp://2130706433/internal/credentials';
    const result = await urls({}, `Visit https://example.com and never fetch ${ambiguousUrl}`, {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      block_userinfo: true,
      allow_subdomains: false,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.allowed).toEqual(['https://example.com']);
    expect(result.info?.blocked).toEqual([ambiguousUrl]);
  });

  it('honours subdomain allowance settings', async () => {
    const result = await urls({}, 'Check https://sub.example.com and https://other.com', {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: true,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toContain('https://sub.example.com');
    expect(result.info?.blocked).toContain('https://other.com');
    expect(result.tripwireTriggered).toBe(true);
  });

  it('allows full URLs with explicit paths in the allow list', async () => {
    const text = [
      'https://suntropy.es',
      'https://api.example.com/v1/tools?id=2',
      'https://api.example.com/v2',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['https://suntropy.es', 'https://api.example.com/v1'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining(['https://suntropy.es', 'https://api.example.com/v1/tools?id=2'])
    );
    expect(result.info?.blocked).toContain('https://api.example.com/v2');
  });

  it('respects path segment boundaries to avoid prefix bypasses', async () => {
    const text = [
      'https://example.com/api',
      'https://example.com/api/users',
      'https://example.com/api2',
      'https://example.com/api-v2',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['https://example.com/api'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining(['https://example.com/api', 'https://example.com/api/users'])
    );
    expect(result.info?.blocked).toEqual(
      expect.arrayContaining(['https://example.com/api2', 'https://example.com/api-v2'])
    );
  });

  it('matches scheme-less allow list entries across configured schemes', async () => {
    const text = ['https://example.com', 'http://example.com'].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https', 'http']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining(['https://example.com', 'http://example.com'])
    );
    expect(result.info?.blocked).toEqual([]);
  });

  it('enforces explicit scheme matches when allow list entries include schemes', async () => {
    const text = ['https://bank.example.com', 'http://bank.example.com'].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['https://bank.example.com'],
      allowed_schemes: new Set(['https', 'http']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(expect.arrayContaining(['https://bank.example.com']));
    expect(result.info?.blocked).toContain('http://bank.example.com');
  });

  it('supports CIDR ranges and explicit port matching', async () => {
    const text = [
      'https://10.5.5.5',
      'https://192.168.1.100',
      'https://192.168.2.1',
      'https://example.com:8443',
      'https://example.com',
      'https://api.internal.com:9000',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: [
        '10.0.0.0/8',
        '192.168.1.0/24',
        'https://example.com:8443',
        'api.internal.com',
      ],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining([
        'https://10.5.5.5',
        'https://192.168.1.100',
        'https://example.com:8443',
        'https://api.internal.com:9000',
      ])
    );
    expect(result.info?.blocked).toEqual(
      expect.arrayContaining(['https://192.168.2.1', 'https://example.com'])
    );
  });

  it('requires query strings and fragments to match exactly when configured', async () => {
    const text = [
      'https://example.com/search?q=test',
      'https://example.com/search?q=other',
      'https://example.com/docs#intro',
      'https://example.com/docs#outro',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['https://example.com/search?q=test', 'https://example.com/docs#intro'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining([
        'https://example.com/search?q=test',
        'https://example.com/docs#intro',
      ])
    );
    expect(result.info?.blocked).toEqual(
      expect.arrayContaining([
        'https://example.com/search?q=other',
        'https://example.com/docs#outro',
      ])
    );
  });

  it('blocks URLs containing only a password in userinfo when configured', async () => {
    const result = await urls({}, 'https://:secret@example.com', {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.blocked).toContain('https://:secret@example.com');
    expect(
      (result.info?.blocked_reasons as string[]).some((reason) => reason.includes('userinfo'))
    ).toBe(true);
  });

  it('handles malformed ports gracefully without crashing', async () => {
    const text = [
      'https://example.com:99999',
      'https://example.com:abc',
      'https://example.com:-1',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toHaveLength(3);
    expect(result.info?.blocked_reasons).toHaveLength(3);
  });

  it('handles trailing slashes in allow list paths correctly', async () => {
    // Regression test: allow list entries with trailing slashes should match subpaths
    // Previously, '/api/' + '/' created '/api//' which wouldn't match '/api/users'
    const text = [
      'https://example.com/api/users',
      'https://example.com/api/v2/data',
      'https://example.com/other',
    ].join(' ');

    const result = await urls({}, text, {
      url_allow_list: ['https://example.com/api/'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    });

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining(['https://example.com/api/users', 'https://example.com/api/v2/data'])
    );
    expect(result.info?.blocked).toContain('https://example.com/other');
  });

  it('matches scheme-less URLs against scheme-qualified allow list entries', async () => {
    // Test exact behavior: scheme-qualified allow list vs scheme-less/explicit URLs
    const config = {
      url_allow_list: ['https://suntropy.es'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    // Test scheme-less URL (should be allowed)
    const result1 = await urls({}, 'Visit suntropy.es', config);
    expect(result1.info?.allowed).toContain('suntropy.es');
    expect(result1.tripwireTriggered).toBe(false);

    // Test HTTPS URL (should match allow list scheme)
    const result2 = await urls({}, 'Visit https://suntropy.es', config);
    expect(result2.info?.allowed).toContain('https://suntropy.es');
    expect(result2.tripwireTriggered).toBe(false);

    // Test HTTP URL (wrong explicit scheme should be blocked)
    const result3 = await urls({}, 'Visit http://suntropy.es', config);
    expect(result3.info?.blocked).toContain('http://suntropy.es');
    expect(result3.tripwireTriggered).toBe(true);
  });

  it('blocks subdomains and paths correctly with scheme-qualified allow list', async () => {
    // Verify subdomains and paths are still blocked according to allow list rules
    const config = {
      url_allow_list: ['https://suntropy.es'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit help-suntropy.es and help.suntropy.es';
    const result = await urls({}, text, config);

    // Both should be blocked - not in allow list
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toHaveLength(2);
    expect(result.info?.blocked).toContain('help-suntropy.es');
    expect(result.info?.blocked).toContain('help.suntropy.es');
  });

  it('treats explicit default ports as equivalent to no port', async () => {
    // URLs with explicit default ports should match allow list entries without ports
    const config = {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https', 'http']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit https://example.com:443 and http://example.com:80';
    const result = await urls({}, text, config);

    // Both should be allowed (443 is default for https, 80 is default for http)
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.allowed).toContain('https://example.com:443');
    expect(result.info?.allowed).toContain('http://example.com:80');
    expect(result.info?.blocked).toEqual([]);
  });

  it('allows any port when allow list entry has no port specification', async () => {
    // When the allow list entry omits a port, URLs with any port (default or non-default) are allowed
    const config = {
      url_allow_list: ['example.com'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit https://example.com:8443 and https://example.com:9000';
    const result = await urls({}, text, config);

    // Both should be allowed - when allow list has no port, any port is OK
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.allowed).toContain('https://example.com:8443');
    expect(result.info?.allowed).toContain('https://example.com:9000');
  });

  it('accepts CIDR /0 with 0.0.0.0 network address', async () => {
    // 0.0.0.0/0 should match all IPs
    const config = {
      url_allow_list: ['0.0.0.0/0'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit https://1.2.3.4 and https://192.168.1.1';
    const result = await urls({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.allowed).toContain('https://1.2.3.4');
    expect(result.info?.allowed).toContain('https://192.168.1.1');
  });

  it('rejects CIDR /0 with non-zero network address', async () => {
    // 10.0.0.0/0 is ambiguous - /0 should only use 0.0.0.0
    const config = {
      url_allow_list: ['10.0.0.0/0'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit https://10.5.5.5 and https://192.168.1.1';
    const result = await urls({}, text, config);

    // Should block both because 10.0.0.0/0 is invalid (emits warning)
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toContain('https://10.5.5.5');
    expect(result.info?.blocked).toContain('https://192.168.1.1');
  });

  it('rejects invalid CIDR prefix values', async () => {
    // Test various invalid CIDR prefixes
    const config = {
      url_allow_list: ['10.0.0.0/33', '192.168.0.0/-1', '172.16.0.0/abc'],
      allowed_schemes: new Set(['https']),
      allow_subdomains: false,
      block_userinfo: true,
    };

    const text = 'Visit https://10.5.5.5 and https://192.168.1.1 and https://172.16.1.1';
    const result = await urls({}, text, config);

    // All should be blocked due to invalid CIDR configurations
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toHaveLength(3);
  });
});

describe('competitors guardrail', () => {
  it('reuses keywords check and annotates guardrail name', () => {
    const result = competitorsCheck({}, 'We prefer Acme Corp over others.', {
      keywords: ['acme corp'],
    }) as GuardrailResult;

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.guardrail_name).toBe('Competitors');
    expect(result.info?.matchedKeywords).toContain('Acme Corp');
  });
});
