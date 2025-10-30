/**
 * Hallucination Detection guardrail module.
 *
 * This module provides a guardrail for detecting when an LLM generates content that
 * may be factually incorrect, unsupported, or "hallucinated." It uses the OpenAI
 * Responses API with file search to validate claims against actual documents.
 *
 * **IMPORTANT: A valid OpenAI vector store must be created before using this guardrail.**
 *
 * To create an OpenAI vector store, you can:
 * 
 * 1. **Use the Guardrails Wizard**: Configure the guardrail through the [Guardrails Wizard](https://guardrails.openai.com/), which provides an option to create a vector store if you don't already have one.
 * 2. **Use the OpenAI Dashboard**: Create a vector store directly in the [OpenAI Dashboard](https://platform.openai.com/storage/vector_stores/).
 * 3. **Follow OpenAI Documentation**: Refer to the "Create a vector store and upload a file" section of the [File Search documentation](https://platform.openai.com/docs/guides/tools-file-search) for detailed instructions.
 * 4. **Use the provided utility script**: Use the `create_vector_store.py` script provided in the [repo](https://github.com/OpenAI-Early-Access/guardrails/blob/main/guardrails/src/guardrails/utils/create_vector_store.py) to create a vector store from local files or directories.
 *
 * **Pricing**: For pricing details on file search and vector storage, see the [Built-in tools section](https://openai.com/api/pricing/) of the OpenAI pricing page.
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult, GuardrailLLMContext } from '../types';
import { defaultSpecRegistry } from '../registry';
import { createErrorResult, LLMErrorOutput } from './llm-base';

/**
 * Configuration schema for hallucination detection.
 *
 * Extends the base LLM configuration with file search validation parameters.
 */
export const HallucinationDetectionConfig = z.object({
  /** The LLM model to use for analysis (e.g., "gpt-4o-mini") */
  model: z.string(),
  /** Minimum confidence score (0.0 to 1.0) required to trigger the guardrail. Defaults to 0.7. */
  confidence_threshold: z.number().min(0.0).max(1.0).default(0.7),
  /** Vector store ID to use for document validation (must start with 'vs_') */
  knowledge_source: z
    .string()
    .regex(/^vs_/, "knowledge_source must be a valid vector store ID starting with 'vs_'"),
});

export type HallucinationDetectionConfig = z.infer<typeof HallucinationDetectionConfig>;

/**
 * Context requirements for the hallucination detection guardrail.
 */
export type HallucinationDetectionContext = GuardrailLLMContext;

/**
 * Output schema for hallucination detection analysis.
 */
export const HallucinationDetectionOutput = z.object({
  /** Whether the content was flagged as potentially hallucinated */
  flagged: z.boolean(),
  /** Confidence score (0.0 to 1.0) that the input is hallucinated */
  confidence: z.number().min(0.0).max(1.0),
  /** Detailed explanation of the analysis */
  reasoning: z.string(),
  /** Type of hallucination detected */
  hallucination_type: z.string().nullable(),
  /** Specific statements flagged as potentially hallucinated */
  hallucinated_statements: z.array(z.string()).nullable(),
  /** Specific statements that are supported by the documents */
  verified_statements: z.array(z.string()).nullable(),
});

export type HallucinationDetectionOutput = z.infer<typeof HallucinationDetectionOutput>;

/**
 * Pre-defined prompt for hallucination detection.
 */
const VALIDATION_PROMPT = `You are an expert at detecting hallucinations in AI-generated text. Your task is to analyze the given text and determine if it contains any FACTUAL CLAIMS that are clearly contradicted or completely unsupported by the provided documents.

**IMPORTANT: Flag content that contains CLEAR CONTRADICTIONS or COMPLETELY UNSUPPORTED claims.**

A factual claim is a specific statement about:
- Product features, specifications, or capabilities
- Prices, costs, fees, or pricing information
- Policies, terms, conditions, or rules
- Dates, times, schedules, or availability
- Names, titles, contact information, or credentials
- Statistics, numbers, percentages, or measurements
- Specific offers, discounts, or promotions
- Technical details, requirements, or limitations
- Company information, history, or facts
- Legal or regulatory information

**DO NOT flag:**
- General greetings, pleasantries, or conversational content
- Opinions, preferences, or subjective statements
- General advice or suggestions without specific claims
- Questions or requests for information
- Emotional expressions or personal statements
- Generic statements that don't contain verifiable facts
- **ANY FACTUAL CLAIMS THAT ARE SUPPORTED BY THE DOCUMENTS**
- **INCOMPLETE BUT ACCURATE STATEMENTS** (statements that are true but don't mention all available options or details)
- **MINOR PHRASING DIFFERENCES** (if the core meaning is correct, don't flag)
- **SIMILAR BUT NOT IDENTICAL WORDING** (if the claim is essentially true, don't flag)

Examples of content that SHOULD be flagged:
- "Our premium plan costs $299/month" (when documents say $199/month - clear contradiction)
- "We offer 24/7 customer support" (when documents don't mention this at all - completely unsupported)
- "The warranty covers 60 days" (when documents say 30 days - clear contradiction)
- **Statements that contain any contradictions or unsupported claims. Even if some claims are supported.**
- "Our jacket is $59.95 and comes in red, and blue" (When the document confirms the price but contradicts the available colors)

Examples of content that should NOT be flagged:
- "Hello, how can I help you today?" (conversational)
- "I'd be happy to assist you" (conversational)
- "That sounds like a great idea" (opinion)
- "Let me check our documentation" (intention)
- "Thank you for your patience" (courtesy)
- "Our premium plan costs $199/month" (when documents confirm this price - supported)
- "You earn 1% back" (when documents confirm this rate - supported, even if incomplete)

Analyze the text and determine if it contains factual claims that are:
1. **Supported by the documents** - Claims that are directly supported by citations (even if not complete) → DO NOT FLAG
2. **Essentially correct** - Claims that have minor phrasing differences but same core meaning → DO NOT FLAG
3. **Clearly contradicted by the documents** - Claims that directly contradict the documents → FLAG
4. **Completely unsupported by the documents** - Claims that cannot be verified from the documents → FLAG

Respond with a JSON object containing:
- "flagged": boolean (true if ANY factual claims are clearly contradicted or completely unsupported)
- "confidence": float (0.0 to 1.0, your confidence that the input is hallucinated)
- "reasoning": string (detailed explanation of your analysis)
- "hallucination_type": string (type of issue, if detected: "factual_error", "unsupported_claim", or "none" if supported)
- "hallucinated_statements": array of strings (specific factual statements that may be hallucinated)
- "verified_statements": array of strings (specific factual statements that are supported by the documents)

**CRITICAL GUIDELINES**: 
- Flag content if ANY factual claims are unsupported or contradicted (even if some claims are supported)
- Allow conversational, opinion-based, or general content to pass through
- Allow content to pass through ONLY if ALL factual claims are supported by documents
- Allow minor phrasing differences if the core meaning is correct
- Focus on claims that could mislead users about products, services, policies, or facts
- You must output a confidence score reflecting how likely the input is hallucinated:
    - 1.0 = Certain hallucinated
    - 0.0 = Certain not hallucinated
    - Use the full range [0.0 - 1.0] to reflect your level of certainty`;

/**
 * Detect potential hallucinations in text by validating against documents.
 *
 * This function uses the OpenAI Responses API with file search and structured output
 * to validate factual claims in the candidate text against the provided knowledge source.
 * It flags content that contains any unsupported or contradicted factual claims.
 *
 * @param ctx Guardrail context containing the LLM client.
 * @param candidate Text to analyze for potential hallucinations.
 * @param config Configuration for hallucination detection.
 * @returns GuardrailResult containing hallucination analysis with flagged status
 *         and confidence score.
 */
export const hallucination_detection: CheckFn<
  HallucinationDetectionContext,
  string,
  HallucinationDetectionConfig
> = async (ctx, candidate, config): Promise<GuardrailResult> => {
  if (!config.knowledge_source || !config.knowledge_source.startsWith('vs_')) {
    throw new Error("knowledge_source must be a valid vector store ID starting with 'vs_'");
  }

  try {
    // Create the validation query
    const validationQuery = `${VALIDATION_PROMPT}\n\nText to validate:\n${candidate}`;

    // Use the Responses API with file search
    const response = await ctx.guardrailLlm.responses.create({
      model: config.model,
      input: validationQuery,
      tools: [
        {
          type: 'file_search',
          vector_store_ids: [config.knowledge_source],
        },
      ],
    });

    // Extract the analysis from the response
    // The response will contain the LLM's analysis in output_text
    const outputText = response.output_text;
    if (!outputText) {
      throw new Error('No analysis result from LLM');
    }

    // Try to extract JSON from the response (it might be wrapped in other text)
    let jsonText = outputText.trim();

    // Look for JSON object in the response
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    // Parse the JSON response
    let parsedJson;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (error) {
      console.warn('Failed to parse LLM response as JSON:', jsonText);
      // Return a safe default if JSON parsing fails using shared error helper
      const errorOutput: LLMErrorOutput = {
        flagged: false,
        confidence: 0.0,
        info: { error_message: `JSON parsing failed: ${error instanceof Error ? error.message : String(error)}` },
      };
      return createErrorResult(
        'Hallucination Detection',
        errorOutput,
        candidate,
        {
          threshold: config.confidence_threshold,
          reasoning: 'LLM response could not be parsed as JSON',
          hallucination_type: null,
          hallucinated_statements: null,
          verified_statements: null,
        }
      );
    }

    const analysis = HallucinationDetectionOutput.parse(parsedJson);

    // Determine if tripwire should be triggered
    const isTrigger = analysis.flagged && analysis.confidence >= config.confidence_threshold;

    return {
      tripwireTriggered: isTrigger,
      info: {
        guardrail_name: 'Hallucination Detection',
        flagged: analysis.flagged,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        hallucination_type: analysis.hallucination_type,
        hallucinated_statements: analysis.hallucinated_statements,
        verified_statements: analysis.verified_statements,
        threshold: config.confidence_threshold,
        checked_text: candidate, // Hallucination Detection doesn't modify text, pass through unchanged
      },
    };
  } catch (error) {
    // Log unexpected errors and return safe default using shared error helper
    console.error('Unexpected error in hallucination_detection:', error);
    const errorOutput: LLMErrorOutput = {
      flagged: false,
      confidence: 0.0,
      info: { error_message: error instanceof Error ? error.message : String(error) },
    };
    return createErrorResult(
      'Hallucination Detection',
      errorOutput,
      candidate,
      {
        threshold: config.confidence_threshold,
        reasoning: `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        hallucination_type: null,
        hallucinated_statements: null,
        verified_statements: null,
      }
    );
  }
};

// Register the guardrail
defaultSpecRegistry.register(
  'Hallucination Detection',
  hallucination_detection,
  'Detects potential hallucinations in AI-generated text using OpenAI Responses API with file search. Validates claims against actual documents and flags factually incorrect, unsupported, or potentially fabricated information.',
  'text/plain',
  HallucinationDetectionConfig as z.ZodType<HallucinationDetectionConfig>,
  undefined,
  { engine: 'FileSearch' }
);
