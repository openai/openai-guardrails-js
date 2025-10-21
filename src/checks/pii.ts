/**
 * PII detection guardrail for sensitive text content.
 *
 * This module implements a guardrail for detecting Personally Identifiable
 * Information (PII) in text using regex patterns. It defines the config
 * schema for entity selection, output/result structures, and the async guardrail
 * check_fn for runtime enforcement.
 *
 * The guardrail supports two modes of operation:
 * - **Masking mode** (block=false, default): Automatically masks PII with placeholder tokens without blocking
 * - **Blocking mode** (block=true): Triggers tripwire when PII is detected, blocking the request
 *
 * **IMPORTANT: PII masking is only supported in the pre-flight stage.**
 * - Use `block=false` (masking mode) in pre-flight to automatically mask PII from user input
 * - Use `block=true` (blocking mode) in output stage to prevent PII exposure in LLM responses
 * - Masking in output stage is not supported and will not work as expected
 *
 * When used in pre-flight stage with masking mode, the masked text is automatically
 * passed to the LLM instead of the original text containing PII.
 *
 * Classes:
 *     PIIEntity: Enum of supported PII entity types across global regions.
 *     PIIConfig: Configuration model specifying what entities to detect and behavior mode.
 *     PiiDetectionResult: Internal container for mapping entity types to findings.
 *
 * Functions:
 *     pii: Async guardrail check_fn for PII detection.
 *
 * Configuration Parameters:
 *     `entities` (list[PIIEntity]): List of PII entity types to detect.
 *     `block` (boolean): If true, triggers tripwire when PII is detected (blocking behavior).
 *                       If false, only masks PII without blocking (masking behavior, default).
 *                       **Note: Masking only works in pre-flight stage. Use block=true for output stage.**
 *
 *     Supported entities include:
 *
 *     - "US_SSN": US Social Security Numbers
 *     - "PHONE_NUMBER": Phone numbers in various formats
 *     - "EMAIL_ADDRESS": Email addresses
 *     - "CREDIT_CARD": Credit card numbers
 *     - "US_BANK_ACCOUNT": US bank account numbers
 *     - And many more.
 *
 * Example:
 * ```typescript
 *     // Masking mode (default) - USE ONLY IN PRE-FLIGHT STAGE
 *     const maskingConfig = { entities: [PIIEntity.US_SSN, PIIEntity.EMAIL_ADDRESS], block: false };
 *     const result1 = await pii(null, "Contact me at john@example.com, SSN: 111-22-3333", maskingConfig);
 *     result1.tripwireTriggered // false
 *     result1.info.checked_text // "Contact me at <EMAIL_ADDRESS>, SSN: <US_SSN>"
 *
 *     // Blocking mode - USE IN OUTPUT STAGE TO PREVENT PII EXPOSURE
 *     const blockingConfig = { entities: [PIIEntity.US_SSN, PIIEntity.EMAIL_ADDRESS], block: true };
 *     const result2 = await pii(null, "Contact me at john@example.com, SSN: 111-22-3333", blockingConfig);
 *     result2.tripwireTriggered // true
 * ```
 */

import { z } from 'zod';
import { CheckFn, GuardrailResult } from '../types';
import { defaultSpecRegistry } from '../registry';

/**
 * Supported PII entity types for detection.
 *
 * Includes global and region-specific types (US, UK, Spain, Italy, etc.).
 * These map to regex patterns for detection.
 */
export enum PIIEntity {
  // Global
  CREDIT_CARD = 'CREDIT_CARD',
  CRYPTO = 'CRYPTO',
  DATE_TIME = 'DATE_TIME',
  EMAIL_ADDRESS = 'EMAIL_ADDRESS',
  IBAN_CODE = 'IBAN_CODE',
  IP_ADDRESS = 'IP_ADDRESS',
  NRP = 'NRP',
  LOCATION = 'LOCATION',
  PERSON = 'PERSON',
  PHONE_NUMBER = 'PHONE_NUMBER',
  MEDICAL_LICENSE = 'MEDICAL_LICENSE',
  URL = 'URL',

  // USA
  US_BANK_NUMBER = 'US_BANK_NUMBER',
  US_DRIVER_LICENSE = 'US_DRIVER_LICENSE',
  US_ITIN = 'US_ITIN',
  US_PASSPORT = 'US_PASSPORT',
  US_SSN = 'US_SSN',

  // UK
  UK_NHS = 'UK_NHS',
  UK_NINO = 'UK_NINO',

  // Spain
  ES_NIF = 'ES_NIF',
  ES_NIE = 'ES_NIE',

  // Italy
  IT_FISCAL_CODE = 'IT_FISCAL_CODE',
  IT_DRIVER_LICENSE = 'IT_DRIVER_LICENSE',
  IT_VAT_CODE = 'IT_VAT_CODE',
  IT_PASSPORT = 'IT_PASSPORT',
  IT_IDENTITY_CARD = 'IT_IDENTITY_CARD',

  // Poland
  PL_PESEL = 'PL_PESEL',

  // Singapore
  SG_NRIC_FIN = 'SG_NRIC_FIN',
  SG_UEN = 'SG_UEN',

  // Australia
  AU_ABN = 'AU_ABN',
  AU_ACN = 'AU_ACN',
  AU_TFN = 'AU_TFN',
  AU_MEDICARE = 'AU_MEDICARE',

  // India
  IN_PAN = 'IN_PAN',
  IN_AADHAAR = 'IN_AADHAAR',
  IN_VEHICLE_REGISTRATION = 'IN_VEHICLE_REGISTRATION',
  IN_VOTER = 'IN_VOTER',
  IN_PASSPORT = 'IN_PASSPORT',

  // Finland
  FI_PERSONAL_IDENTITY_CODE = 'FI_PERSONAL_IDENTITY_CODE',
}

/**
 * Configuration schema for PII detection.
 *
 * Used to control which entity types are checked and the behavior mode.
 */
export const PIIConfig = z.object({
  entities: z.array(z.nativeEnum(PIIEntity)).default(() => Object.values(PIIEntity)),
  block: z
    .boolean()
    .default(false)
    .describe(
      'If true, triggers tripwire when PII is detected. If false, masks PII without blocking.'
    ),
});

export type PIIConfig = z.infer<typeof PIIConfig>;

// Schema for registry registration (without optional properties)
export const PIIConfigRequired = z
  .object({
    entities: z.array(z.nativeEnum(PIIEntity)),
    block: z.boolean(),
  })
  .transform((data) => ({
    ...data,
    block: data.block ?? false, // Provide default if not specified
  }));

/**
 * Internal result structure for PII detection.
 */
interface PiiDetectionResult {
  mapping: Record<string, string[]>;
  analyzerResults: PiiAnalyzerResult[];
}

/**
 * PII analyzer result structure.
 */
interface PiiAnalyzerResult {
  entityType: string;
  start: number;
  end: number;
  score: number;
}

/**
 * Default regex patterns for PII entity types.
 */
const DEFAULT_PII_PATTERNS: Record<PIIEntity, RegExp> = {
  [PIIEntity.CREDIT_CARD]: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  [PIIEntity.CRYPTO]: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
  [PIIEntity.DATE_TIME]: /\b(0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b/g,
  [PIIEntity.EMAIL_ADDRESS]: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  [PIIEntity.IBAN_CODE]: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}\b/g,
  [PIIEntity.IP_ADDRESS]: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
  [PIIEntity.NRP]: /\b[A-Za-z]+ [A-Za-z]+\b/g,
  [PIIEntity.LOCATION]:
    /\b[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Way|Highway|Hwy)\b/g,
  [PIIEntity.PERSON]: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,
  [PIIEntity.PHONE_NUMBER]: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  [PIIEntity.MEDICAL_LICENSE]: /\b[A-Z]{2}\d{6}\b/g,
  [PIIEntity.URL]:
    /\bhttps?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w/_.])*(?:\?(?:[\w&=%.])*)?(?:#(?:[\w.])*)?)?/g,

  // USA
  [PIIEntity.US_BANK_NUMBER]: /\b\d{8,17}\b/g,
  [PIIEntity.US_DRIVER_LICENSE]: /\b[A-Z]\d{7}\b/g,
  [PIIEntity.US_ITIN]: /\b9\d{2}-\d{2}-\d{4}\b/g,
  [PIIEntity.US_PASSPORT]: /\b[A-Z]\d{8}\b/g,
  [PIIEntity.US_SSN]: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g,

  // UK
  [PIIEntity.UK_NHS]: /\b\d{3} \d{3} \d{4}\b/g,
  [PIIEntity.UK_NINO]: /\b[A-Z]{2}\d{6}[A-Z]\b/g,

  // Spain
  [PIIEntity.ES_NIF]: /\b[A-Z]\d{8}\b/g,
  [PIIEntity.ES_NIE]: /\b[A-Z]\d{8}\b/g,

  // Italy
  [PIIEntity.IT_FISCAL_CODE]: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g,
  [PIIEntity.IT_DRIVER_LICENSE]: /\b[A-Z]{2}\d{7}\b/g,
  [PIIEntity.IT_VAT_CODE]: /\bIT\d{11}\b/g,
  [PIIEntity.IT_PASSPORT]: /\b[A-Z]{2}\d{7}\b/g,
  [PIIEntity.IT_IDENTITY_CARD]: /\b[A-Z]{2}\d{7}\b/g,

  // Poland
  [PIIEntity.PL_PESEL]: /\b\d{11}\b/g,

  // Singapore
  [PIIEntity.SG_NRIC_FIN]: /\b[A-Z]\d{7}[A-Z]\b/g,
  [PIIEntity.SG_UEN]: /\b\d{8}[A-Z]\b|\b\d{9}[A-Z]\b/g,

  // Australia
  [PIIEntity.AU_ABN]: /\b\d{2} \d{3} \d{3} \d{3}\b/g,
  [PIIEntity.AU_ACN]: /\b\d{3} \d{3} \d{3}\b/g,
  [PIIEntity.AU_TFN]: /\b\d{9}\b/g,
  [PIIEntity.AU_MEDICARE]: /\b\d{4} \d{5} \d{1}\b/g,

  // India
  [PIIEntity.IN_PAN]: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
  [PIIEntity.IN_AADHAAR]: /\b\d{4} \d{4} \d{4}\b/g,
  [PIIEntity.IN_VEHICLE_REGISTRATION]: /\b[A-Z]{2}\d{2}[A-Z]{2}\d{4}\b/g,
  [PIIEntity.IN_VOTER]: /\b[A-Z]{3}\d{7}\b/g,
  [PIIEntity.IN_PASSPORT]: /\b[A-Z]\d{7}\b/g,

  // Finland
  [PIIEntity.FI_PERSONAL_IDENTITY_CODE]: /\b\d{6}[+-A]\d{3}[A-Z0-9]\b/g,
};

/**
 * Run regex analysis and collect findings by entity type.
 *
 * @param text The text to analyze for PII
 * @param config PII detection configuration
 * @returns Object containing mapping of entities to detected snippets
 * @throws Error if text is empty or null
 */
function _detectPii(text: string, config: PIIConfig): PiiDetectionResult {
  if (!text) {
    throw new Error('Text cannot be empty or null');
  }

  const grouped: Record<string, string[]> = {};
  const analyzerResults: PiiAnalyzerResult[] = [];

  // Check each configured entity type
  for (const entity of config.entities) {
    const pattern = DEFAULT_PII_PATTERNS[entity];
    if (pattern) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;

      while ((match = regex.exec(text)) !== null) {
        const entityType = entity;
        const start = match.index;
        const end = match.index + match[0].length;
        const score = 0.9; // High confidence for regex matches

        if (!grouped[entityType]) {
          grouped[entityType] = [];
        }
        grouped[entityType].push(text.substring(start, end));

        analyzerResults.push({
          entityType,
          start,
          end,
          score,
        });
      }
    }
  }

  return {
    mapping: grouped,
    analyzerResults,
  };
}

/**
 * Scrub detected PII from text by replacing with entity type markers.
 *
 * Handles overlapping entities using these rules:
 * 1. Full overlap: Use entity with higher score
 * 2. One contained in another: Use larger text span
 * 3. Partial intersection: Replace each individually
 * 4. No overlap: Replace normally
 *
 * @param text The text to scrub
 * @param detection Results from PII detection
 * @param config PII detection configuration
 * @returns Text with PII replaced by entity type markers
 * @throws Error if text is empty or null
 */
function _scrubPii(text: string, detection: PiiDetectionResult, _config: PIIConfig): string {
  if (!text) {
    throw new Error('Text cannot be empty or null');
  }

  // Sort by start position and score for consistent handling
  const sortedResults = [...detection.analyzerResults].sort(
    (a, b) => a.start - b.start || b.score - a.score || b.end - a.end
  );

  // Process results in order, tracking text offsets
  let result = text;
  let offset = 0;

  for (const res of sortedResults) {
    const start = res.start + offset;
    const end = res.end + offset;
    const replacement = `<${res.entityType}>`;
    result = result.substring(0, start) + replacement + result.substring(end);
    offset += replacement.length - (end - start);
  }

  return result;
}

/**
 * Convert detection results to a GuardrailResult for reporting.
 *
 * @param detection Results of the PII scan
 * @param config Original detection configuration
 * @param name Name for the guardrail in result metadata
 * @param text Original input text for scrubbing
 * @returns Includes anonymized_text/checked_text and respects block setting for tripwire
 */
function _asResult(
  detection: PiiDetectionResult,
  config: PIIConfig,
  name: string,
  text: string
): GuardrailResult {
  const piiFound = detection.mapping && Object.keys(detection.mapping).length > 0;

  // Scrub the text if PII is found
  const checkedText = piiFound ? _scrubPii(text, detection, config) : text;

  return {
    // Only trigger tripwire if block=true AND PII is found
    tripwireTriggered: config.block && piiFound,
    info: {
      guardrail_name: name,
      detected_entities: detection.mapping,
      entity_types_checked: config.entities,
      anonymized_text: checkedText, // Legacy compatibility
      checked_text: checkedText, // Primary field for preflight modifications
    },
  };
}

/**
 * Async guardrail check_fn for PII entity detection in text.
 *
 * Analyzes text for any configured PII entity types and reports results. If
 * any entity is detected, the tripwire is triggered unless scrubbing is enabled.
 *
 * @param ctx Guardrail runtime context (unused)
 * @param data The input text to scan
 * @param config Guardrail configuration for PII detection
 * @returns Indicates if any PII was found, and the findings
 * @throws Error if input text is empty or null
 */
export const pii: CheckFn<Record<string, unknown>, string, PIIConfig> = async (
  _ctx,
  data,
  config
): Promise<GuardrailResult> => {
  const result = _detectPii(data, config);
  return _asResult(result, config, 'Contains PII', data);
};

// Auto-register this guardrail with the default registry
defaultSpecRegistry.register(
  'Contains PII',
  pii,
  'Checks that the text does not contain personally identifiable information (PII) such as SSNs, phone numbers, credit card numbers, etc., based on configured entity types.',
  'text/plain',
  PIIConfigRequired,
  undefined,
  { engine: 'Regex' }
);
