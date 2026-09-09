import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const base = process.env.DOCS_BASE || '/openai-guardrails-js/';
// URLs and heading IDs captured from the published MkDocs site on 2026-09-09.
const baseline = JSON.parse(
  readFileSync(new URL('./fixtures/docs-urls.json', import.meta.url), 'utf8')
);
const pages = readdirSync(site, { recursive: true }).filter((file) => file.endsWith('.html'));

function ids(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

test('all previously published pages and heading links still exist', () => {
  for (const page of baseline) {
    const file = `${site}${page.path}index.html`;
    assert.ok(existsSync(file), `Missing published page: ${page.path}`);
    const headings = ids(readFileSync(file, 'utf8'));
    for (const heading of page.headings) {
      assert.ok(headings.has(heading), `Missing published heading: ${page.path}#${heading}`);
    }
  }
});

test('generated local links, fragments, and assets resolve under the deployment base', () => {
  for (const page of pages) {
    const html = readFileSync(`${site}${page}`, 'utf8');
    const pageUrl = new URL(`${base}${page}`, 'https://docs.test');
    for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = new URL(value.replaceAll('&amp;', '&'), pageUrl);
      if (url.origin !== pageUrl.origin) continue;
      assert.ok(url.pathname.startsWith(base), `${page}: URL outside base: ${value}`);
      let target = decodeURIComponent(url.pathname.slice(base.length));
      if (target.endsWith('/') || target === '') target += 'index.html';
      const file = `${site}${target}`;
      assert.ok(existsSync(file), `${page}: Missing target: ${value}`);
      if (url.hash && target.endsWith('.html')) {
        const targetIds = ids(readFileSync(file, 'utf8'));
        assert.ok(
          targetIds.has(decodeURIComponent(url.hash.slice(1))),
          `${page}: Missing fragment: ${value}`
        );
      }
    }
  }
});
