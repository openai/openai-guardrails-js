import { describe, it, expect } from 'vitest';
import {
  appendAssistantResponse,
  mergeConversationWithItems,
  normalizeConversation,
  parseConversationInput,
} from '../../../utils/conversation';

describe('conversation utilities', () => {
  describe('normalizeConversation', () => {
    it('normalizes plain user strings', () => {
      const result = normalizeConversation('hello');
      expect(result).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('normalizes mixed message objects and tool calls', () => {
      const result = normalizeConversation([
        { role: 'user', content: 'search for docs' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_1',
              function: { name: 'search_docs', arguments: '{"query": "docs"}' },
            },
          ],
        },
      ]);

      expect(result).toEqual([
        { role: 'user', content: 'search for docs' },
        { role: 'assistant' },
        {
          type: 'function_call',
          tool_name: 'search_docs',
          arguments: '{"query": "docs"}',
          call_id: 'call_1',
        },
      ]);
    });

    it('handles responses API content arrays', () => {
      const result = normalizeConversation([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        },
      ]);

      expect(result).toEqual([{ role: 'user', content: 'hello world' }]);
    });
  });

  describe('appendAssistantResponse', () => {
    it('appends assistant output from chat responses', () => {
      const history = [{ role: 'user', content: 'hi' }];
      const response = {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'hello back',
            },
          },
        ],
      };

      const result = appendAssistantResponse(history, response);
      expect(result).toEqual([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello back' },
      ]);
    });
  });

  describe('mergeConversationWithItems', () => {
    it('extends conversation history with additional tool output items', () => {
      const history = [{ role: 'user', content: 'plan trip' }];
      const items = [
        {
          type: 'function_call_output',
          tool_name: 'calendar',
          arguments: '{"date":"2025-01-01"}',
          output: '{"available": true}',
        },
      ];

      const result = mergeConversationWithItems(history, items);
      expect(result).toEqual([
        { role: 'user', content: 'plan trip' },
        {
          type: 'function_call_output',
          tool_name: 'calendar',
          arguments: '{"date":"2025-01-01"}',
          output: '{"available": true}',
        },
      ]);
    });
  });

  describe('parseConversationInput', () => {
    it('parses JSON strings extracting messages', () => {
      const payload = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
      const result = parseConversationInput(payload);
      expect(result).toEqual([{ role: 'user', content: 'hello' }]);
    });

    it('falls back to empty array for unsupported payloads', () => {
      expect(parseConversationInput(123)).toEqual([]);
    });
  });
});
