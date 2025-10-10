/**
 * Tests for response parsing utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseResponseItems,
  parseResponseItemsAsJson,
  formatEntriesAsJson,
  formatEntriesAsText,
  formatEntries,
  Entry,
} from '../../../utils/parsing';

describe('parsing utilities', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  afterEach(() => {
    warnSpy.mockReset();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('parses choices with string content', () => {
    const response = {
      choices: [
        { message: { role: 'user', content: 'Hello' } },
        { message: { role: 'assistant', content: 'Hi there!' } },
      ],
    };

    const entries = parseResponseItems(response);
    expect(entries).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('flattens multi-part content arrays', () => {
    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'input_text', text: 'Segment 1' },
              ' + segment 2',
              { type: 'unknown', foo: 'bar' },
            ],
          },
        },
      ],
    };

    const entries = parseResponseItems(response);
    expect(entries).toEqual([{ role: 'assistant', content: 'Segment 1 + segment 2' }]);
    expect(warnSpy).toHaveBeenCalled(); // unknown part logs warning
  });

  it('supports filtering entries by predicate', () => {
    const response = {
      choices: [
        { message: { role: 'user', content: 'Hello' } },
        { message: { role: 'assistant', content: 'Hi there!' } },
      ],
    };

    const entries = parseResponseItems(response, (entry) => entry.role === 'assistant');
    expect(entries).toEqual([{ role: 'assistant', content: 'Hi there!' }]);
  });

  it('parses only valid JSON strings via parseResponseItemsAsJson', () => {
    const response = {
      choices: [
        { message: { role: 'assistant', content: '{"foo": 1}' } },
        { message: { role: 'assistant', content: 'not json' } },
      ],
    };

    const entries = parseResponseItemsAsJson(response);
    expect(entries).toEqual([{ role: 'assistant', content: '{"foo": 1}' }]);
  });

  it('formats entries to json and text', () => {
    const entries: Entry[] = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ];

    const json = formatEntriesAsJson(entries);
    expect(JSON.parse(json)).toHaveLength(2);

    const text = formatEntriesAsText(entries);
    expect(text).toBe('user: question\nassistant: answer');

    expect(formatEntries(entries, 'json')).toBe(json);
    expect(formatEntries(entries, 'text')).toBe(text);
    expect(formatEntries(entries)).toBe(text);
  });
});
