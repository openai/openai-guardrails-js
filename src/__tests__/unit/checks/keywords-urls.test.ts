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

  it('allows full URLs with explicit paths in the allow list', async () => {
    const text = [
      'https://suntropy.es',
      'https://api.example.com/v1/tools?id=2',
      'https://api.example.com/v2',
    ].join(' ');

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['https://suntropy.es', 'https://api.example.com/v1'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining([
        'https://suntropy.es',
        'https://api.example.com/v1/tools?id=2',
      ])
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

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['https://example.com/api'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining([
        'https://example.com/api',
        'https://example.com/api/users',
      ])
    );
    expect(result.info?.blocked).toEqual(
      expect.arrayContaining([
        'https://example.com/api2',
        'https://example.com/api-v2',
      ])
    );
  });

  it('matches scheme-less allow list entries across configured schemes', async () => {
    const text = ['https://example.com', 'http://example.com'].join(' ');

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https', 'http']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining(['https://example.com', 'http://example.com'])
    );
    expect(result.info?.blocked).toEqual([]);
  });

  it('enforces explicit scheme matches when allow list entries include schemes', async () => {
    const text = ['https://bank.example.com', 'http://bank.example.com'].join(' ');

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['https://bank.example.com'],
        allowed_schemes: new Set(['https', 'http']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

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

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['10.0.0.0/8', '192.168.1.0/24', 'https://example.com:8443', 'api.internal.com'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

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

    const result = await urls(
      {},
      text,
      {
        url_allow_list: [
          'https://example.com/search?q=test',
          'https://example.com/docs#intro',
        ],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

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
    const result = await urls(
      {},
      'https://:secret@example.com',
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

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

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['example.com'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

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

    const result = await urls(
      {},
      text,
      {
        url_allow_list: ['https://example.com/api/'],
        allowed_schemes: new Set(['https']),
        allow_subdomains: false,
        block_userinfo: true,
      }
    );

    expect(result.info?.allowed).toEqual(
      expect.arrayContaining([
        'https://example.com/api/users',
        'https://example.com/api/v2/data',
      ])
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
