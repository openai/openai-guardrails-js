/**
 * Unit tests for safety identifier utilities.
 *
 * These tests verify the detection logic for determining whether a client
 * supports the safety_identifier parameter in OpenAI API calls.
 */

import { describe, it, expect } from 'vitest';
import { supportsSafetyIdentifier, SAFETY_IDENTIFIER } from '../../../utils/safety-identifier';

describe('Safety Identifier utilities', () => {
  describe('SAFETY_IDENTIFIER constant', () => {
    it('should have the correct value', () => {
      expect(SAFETY_IDENTIFIER).toBe('openai-guardrails-js');
    });
  });

  describe('supportsSafetyIdentifier', () => {
    it('should return true for official OpenAI client with default baseURL', () => {
      // Mock an official OpenAI client (no custom baseURL)
      const mockClient = {
        constructor: { name: 'OpenAI' },
        baseURL: undefined,
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(true);
    });

    it('should return true for OpenAI client with explicit api.openai.com baseURL', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        baseURL: 'https://api.openai.com/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(true);
    });

    it('should return false for Azure OpenAI client', () => {
      const mockClient = {
        constructor: { name: 'AzureOpenAI' },
        baseURL: 'https://example.openai.azure.com/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return false for AsyncAzureOpenAI client', () => {
      const mockClient = {
        constructor: { name: 'AsyncAzureOpenAI' },
        baseURL: 'https://example.openai.azure.com/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return false for local model with custom baseURL (Ollama)', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        baseURL: 'http://localhost:11434/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return false for alternative OpenAI-compatible provider', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        baseURL: 'https://api.together.xyz/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return false for vLLM server', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        baseURL: 'http://localhost:8000/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return false for null client', () => {
      expect(supportsSafetyIdentifier(null)).toBe(false);
    });

    it('should return false for undefined client', () => {
      expect(supportsSafetyIdentifier(undefined)).toBe(false);
    });

    it('should return false for non-object client', () => {
      expect(supportsSafetyIdentifier('not an object')).toBe(false);
      expect(supportsSafetyIdentifier(123)).toBe(false);
    });

    it('should check _client.baseURL if baseURL is not directly accessible', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        _client: {
          baseURL: 'http://localhost:11434/v1',
        },
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should check _baseURL if baseURL and _client.baseURL are not accessible', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        _baseURL: 'http://localhost:11434/v1',
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(false);
    });

    it('should return true when api.openai.com is found via _client.baseURL', () => {
      const mockClient = {
        constructor: { name: 'OpenAI' },
        _client: {
          baseURL: 'https://api.openai.com/v1',
        },
      };
      
      expect(supportsSafetyIdentifier(mockClient)).toBe(true);
    });
  });
});

