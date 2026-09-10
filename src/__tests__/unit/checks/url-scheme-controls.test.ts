import { describe, expect, it } from 'vitest';
import { UrlsConfig, urls } from '../../../checks/urls';

describe('URL Filter control-bearing scheme prefixes', () => {
  const config = UrlsConfig.parse({
    url_allow_list: ['example.com'],
    allowed_schemes: ['http', 'https', 'ftp', 'data', 'javascript', 'vbscript'],
  });

  it.each([
    'h\tttp:',
    'ht\ntps:',
    'ft\rp:',
    'dat\ta:',
    'java\nscript:',
    'vbs\rcript:',
    'HTTPS\t:',
    'h\t\r\nttp:',
  ])('rejects ambiguous scheme prefix %j even with an allowed destination', async (prefix) => {
    const result = await urls({}, `${prefix}//example.com`, config);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected).toContain(prefix);
    expect(result.info?.blocked).toContain(prefix);
    expect(result.info?.blocked_reasons).toContain(
      `${prefix}: Ambiguous URL scheme containing ASCII control characters`
    );
  });

  it('reports an ambiguous prefix alongside independent allowed URLs', async () => {
    const result = await urls(
      {},
      'See https://example.com/help and _ht\ttps://example.com',
      config
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked).toContain('ht\ttps:');
    expect(result.info?.allowed).toContain('https://example.com/help');
  });

  it.each(['1', '1.', '+', '-.', '123+.-'])(
    'preserves the existing URL boundary after prefix %j',
    async (leading) => {
      const result = await urls({}, `${leading}https\t://example.com`, config);

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info?.blocked).toContain('https\t:');
    }
  );

  it.each([
    'https://example.com/docs/javascript\n:section',
    'https://example.com/search?q=data\t:value',
    'https://example.com/#data\r:value',
    'https://example.com/docs/http\t://example.com',
  ])('keeps a scheme-like word inside an existing URL: %j', async (text) => {
    const result = await urls({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each(['example.com/docs/javascript\n:section', '192.0.2.1/docs/data\t:value'])(
    'keeps scheme-like words inside bare URL paths: %j',
    async (text) => {
      const result = await urls(
        {},
        text,
        UrlsConfig.parse({ url_allow_list: ['example.com', '192.0.2.1'] })
      );

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.blocked).toEqual([]);
    }
  );

  it.each([
    'HTTP\t: Hypertext Transfer Protocol',
    'javascript\n: a language label',
    'ftp\r:',
    'data\t:',
    'HTTP\t://',
  ])('preserves labels without a URL continuation: %j', async (text) => {
    const result = await urls({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.blocked).toEqual([]);
  });

  it.each([
    'See https://example.com and email user@example.com',
    'See https://example.com for details.\nContact user@example.com',
    'https://example.com\nhttps://example.com/help',
    'https://example.com\r\nThen continue',
    'https://example.com\tmore text',
    'https://example.com\n',
  ])('preserves ordinary text boundaries in %j', async (text) => {
    const result = await urls({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.blocked).toEqual([]);
    expect(result.info?.allowed).toContain('https://example.com');
  });

  it('keeps ordinary scheme policy enforcement when text contains line breaks', async () => {
    const result = await urls(
      {},
      'Read this:\nhttp://example.com',
      UrlsConfig.parse({ url_allow_list: ['example.com'] })
    );

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.blocked_reasons).toContain('http://example.com: Blocked scheme: http');
  });

  it.each(['metadata\n: available', 'metadata\t: available', 'metadata\r: available'])(
    'does not treat scheme-name suffixes in ordinary words as URLs: %j',
    async (text) => {
      const result = await urls({}, text, config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info?.detected).toEqual([]);
    }
  );
});
