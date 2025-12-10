/**
 * Unit tests for the hallucination detection guardrail.
 */

import { describe, it, expect, vi } from 'vitest';
import { OpenAI } from 'openai';
import {
  hallucination_detection,
  HallucinationDetectionConfig,
} from '../../../checks/hallucination-detection';
import { GuardrailLLMContext } from '../../../types';

/**
 * Mock OpenAI responses API for testing.
 */
function createMockContext(responseContent: string): GuardrailLLMContext {
  return {
    guardrailLlm: {
      responses: {
        create: vi.fn().mockResolvedValue({
          output_text: responseContent,
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        }),
      },
    } as unknown as OpenAI,
  };
}

describe('Hallucination Detection', () => {
  const validVectorStore = 'vs_test123';

  describe('include_reasoning behavior', () => {
    it('should include reasoning fields when include_reasoning=true', async () => {
      const responseContent = JSON.stringify({
        flagged: true,
        confidence: 0.85,
        reasoning: 'The claim about pricing contradicts the documented information',
        hallucination_type: 'factual_error',
        hallucinated_statements: ['Our premium plan costs $299/month'],
        verified_statements: ['Customer support available'],
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
        include_reasoning: true,
      };

      const result = await hallucination_detection(context, 'Test claim about pricing', config);

      expect(result.tripwireTriggered).toBe(true);
      expect(result.info.flagged).toBe(true);
      expect(result.info.confidence).toBe(0.85);
      expect(result.info.threshold).toBe(0.7);

      // Verify reasoning fields are present
      expect(result.info.reasoning).toBe(
        'The claim about pricing contradicts the documented information'
      );
      expect(result.info.hallucination_type).toBe('factual_error');
      expect(result.info.hallucinated_statements).toEqual(['Our premium plan costs $299/month']);
      expect(result.info.verified_statements).toEqual(['Customer support available']);
    });

    it('should exclude reasoning fields when include_reasoning=false', async () => {
      const responseContent = JSON.stringify({
        flagged: false,
        confidence: 0.2,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
        include_reasoning: false,
      };

      const result = await hallucination_detection(context, 'Test claim', config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.2);
      expect(result.info.threshold).toBe(0.7);

      // Verify reasoning fields are NOT present
      expect(result.info.reasoning).toBeUndefined();
      expect(result.info.hallucination_type).toBeUndefined();
      expect(result.info.hallucinated_statements).toBeUndefined();
      expect(result.info.verified_statements).toBeUndefined();
    });

    it('should exclude reasoning fields when include_reasoning is omitted (defaults to false)', async () => {
      const responseContent = JSON.stringify({
        flagged: false,
        confidence: 0.3,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
        // include_reasoning not specified, should default to false
      };

      const result = await hallucination_detection(context, 'Another test claim', config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.3);

      // Verify reasoning fields are NOT present
      expect(result.info.reasoning).toBeUndefined();
      expect(result.info.hallucination_type).toBeUndefined();
      expect(result.info.hallucinated_statements).toBeUndefined();
      expect(result.info.verified_statements).toBeUndefined();
    });
  });

  describe('vector store validation', () => {
    it('should throw error when knowledge_source does not start with vs_', async () => {
      const context = createMockContext(JSON.stringify({ flagged: false, confidence: 0 }));
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: 'invalid_id',
      };

      await expect(hallucination_detection(context, 'Test', config)).rejects.toThrow(
        "knowledge_source must be a valid vector store ID starting with 'vs_'"
      );
    });

    it('should throw error when knowledge_source is empty string', async () => {
      const context = createMockContext(JSON.stringify({ flagged: false, confidence: 0 }));
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: '',
      };

      await expect(hallucination_detection(context, 'Test', config)).rejects.toThrow(
        "knowledge_source must be a valid vector store ID starting with 'vs_'"
      );
    });

    it('should accept valid vector store ID starting with vs_', async () => {
      const responseContent = JSON.stringify({
        flagged: false,
        confidence: 0.1,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: 'vs_valid123',
      };

      const result = await hallucination_detection(context, 'Valid test', config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.info.flagged).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle JSON parsing errors gracefully', async () => {
      const context = createMockContext('NOT VALID JSON');
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
      };

      const result = await hallucination_detection(context, 'Test', config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.executionFailed).toBe(true);
      expect(result.info.flagged).toBe(false);
      expect(result.info.confidence).toBe(0.0);
      expect(result.info.error_message).toContain('JSON parsing failed');
    });

    it('should handle API errors gracefully', async () => {
      const context = {
        guardrailLlm: {
          responses: {
            create: vi.fn().mockRejectedValue(new Error('API timeout')),
          },
        } as unknown as OpenAI,
      };

      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
      };

      const result = await hallucination_detection(context, 'Test', config);

      expect(result.tripwireTriggered).toBe(false);
      expect(result.executionFailed).toBe(true);
      expect(result.info.error_message).toContain('API timeout');
    });
  });

  describe('tripwire behavior', () => {
    it('should trigger when flagged=true and confidence >= threshold', async () => {
      const responseContent = JSON.stringify({
        flagged: true,
        confidence: 0.9,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
      };

      const result = await hallucination_detection(context, 'Test', config);

      expect(result.tripwireTriggered).toBe(true);
    });

    it('should not trigger when confidence < threshold', async () => {
      const responseContent = JSON.stringify({
        flagged: true,
        confidence: 0.5,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
      };

      const result = await hallucination_detection(context, 'Test', config);

      expect(result.tripwireTriggered).toBe(false);
    });

    it('should not trigger when flagged=false', async () => {
      const responseContent = JSON.stringify({
        flagged: false,
        confidence: 0.9,
      });

      const context = createMockContext(responseContent);
      const config: HallucinationDetectionConfig = {
        model: 'gpt-4.1-mini',
        confidence_threshold: 0.7,
        knowledge_source: validVectorStore,
      };

      const result = await hallucination_detection(context, 'Test', config);

      expect(result.tripwireTriggered).toBe(false);
    });
  });
});

