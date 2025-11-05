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

const ZERO_WIDTH_CHARACTERS = /(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)/g;
const BASE64_PATTERN = /(?:data:[^,]+,)?(?:base64,)?([A-Za-z0-9+/]{16,}={0,2})/g;
const HEX_PATTERN = /\b[0-9a-fA-F]{24,}\b/g;
const URL_ENCODED_PATTERN = /(?:%[0-9A-Fa-f]{2}){3,}/g;
const MAX_DECODED_BYTES = 10_000;

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

  // Custom recognizers
  CVV = 'CVV',
  BIC_SWIFT = 'BIC_SWIFT',

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

  // Korea
  KR_RRN = 'KR_RRN',
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
  detect_encoded_pii: z
    .boolean()
    .default(false)
    .describe('If true, detects PII in encoded content (Base64, URL-encoded, hex).'),
});

export type PIIConfig = z.infer<typeof PIIConfig>;

// Schema for registry registration (without optional properties)
export const PIIConfigRequired = z
  .object({
    entities: z.array(z.nativeEnum(PIIEntity)),
    block: z.boolean(),
    detect_encoded_pii: z.boolean(),
  })
  .transform((data) => ({
    ...data,
    block: data.block ?? false, // Provide default if not specified
    detect_encoded_pii: data.detect_encoded_pii ?? false,
  }));

/**
 * Internal result structure for PII detection.
 */
interface PatternDefinition {
  regex: RegExp;
  group?: number;
}

interface ReplacementSpan {
  start: number;
  end: number;
  entityType: string;
  replacement: string;
  priority: number;
}

interface EncodedCandidate {
  start: number;
  end: number;
  encodedText: string;
  decodedText: string;
  type: 'base64' | 'hex' | 'url';
}

interface PiiDetectionResult {
  normalizedText: string;
  plainMapping: Record<string, Set<string>>;
  encodedMapping: Record<string, Set<string>>;
  spans: ReplacementSpan[];
}

/**
 * Default regex patterns for PII entity types.
 */
const DEFAULT_PII_PATTERNS: Record<PIIEntity, PatternDefinition[]> = {
  [PIIEntity.CREDIT_CARD]: [{ regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g }],
  [PIIEntity.CRYPTO]: [{ regex: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g }],
  [PIIEntity.DATE_TIME]: [{ regex: /\b(0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])[/-](19|20)\d{2}\b/g }],
  [PIIEntity.EMAIL_ADDRESS]: [
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    {
      regex: new RegExp('(?<=[?&=/])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', 'g'),
    },
  ],
  [PIIEntity.IBAN_CODE]: [{ regex: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}\b/g }],
  [PIIEntity.IP_ADDRESS]: [{ regex: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g }],
  [PIIEntity.NRP]: [{ regex: /\b[A-Za-z]+ [A-Za-z]+\b/g }],
  [PIIEntity.LOCATION]: [
    {
      regex:
        /\b\d{1,6}\s[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Place|Pl|Court|Ct|Way|Highway|Hwy|Parkway|Pkwy|Circle|Cir|Trail|Trl|Terrace|Ter)\b/gi,
    },
    {
      regex: /\b\d{1,6}\s[A-Za-z0-9\s]+,\s*[A-Za-z\s]+,\s*[A-Z]{2}\b/g,
    },
  ],
  [PIIEntity.PERSON]: [{ regex: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g }],
  [PIIEntity.PHONE_NUMBER]: [{ regex: /\b(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g }],
  [PIIEntity.MEDICAL_LICENSE]: [{ regex: /\b[A-Z]{2}\d{6}\b/g }],
  [PIIEntity.URL]: [
    {
      regex:
        /\bhttps?:\/\/(?:[-\w.])+(?::[0-9]+)?(?:\/(?:[\w/_.])*(?:\?(?:[\w&=%.])*)?(?:#(?:[\w.])*)?)?/g,
    },
  ],
  [PIIEntity.CVV]: [
    {
      regex: /\b(?:cvv|cvc|security\s*code|card\s*code)[\s:=]*([0-9]{3,4})\b/gi,
      group: 1,
    },
  ],
  [PIIEntity.BIC_SWIFT]: [{ regex: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g }],

  // USA
  [PIIEntity.US_BANK_NUMBER]: [{ regex: /\b\d{8,17}\b/g }],
  [PIIEntity.US_DRIVER_LICENSE]: [{ regex: /\b[A-Z]\d{7}\b/g }],
  [PIIEntity.US_ITIN]: [{ regex: /\b9\d{2}-\d{2}-\d{4}\b/g }],
  [PIIEntity.US_PASSPORT]: [{ regex: /\b[A-Z]\d{8}\b/g }],
  [PIIEntity.US_SSN]: [{ regex: /\b\d{3}-\d{2}-\d{4}\b|\b\d{9}\b/g }],

  // UK
  [PIIEntity.UK_NHS]: [{ regex: /\b\d{3} \d{3} \d{4}\b/g }],
  [PIIEntity.UK_NINO]: [{ regex: /\b[A-Z]{2}\d{6}[A-Z]\b/g }],

  // Spain
  [PIIEntity.ES_NIF]: [{ regex: /\b[A-Z]\d{8}\b/g }],
  [PIIEntity.ES_NIE]: [{ regex: /\b[A-Z]\d{8}\b/g }],

  // Italy
  [PIIEntity.IT_FISCAL_CODE]: [{ regex: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g }],
  [PIIEntity.IT_DRIVER_LICENSE]: [{ regex: /\b[A-Z]{2}\d{7}\b/g }],
  [PIIEntity.IT_VAT_CODE]: [{ regex: /\bIT\d{11}\b/g }],
  [PIIEntity.IT_PASSPORT]: [{ regex: /\b[A-Z]{2}\d{7}\b/g }],
  [PIIEntity.IT_IDENTITY_CARD]: [{ regex: /\b[A-Z]{2}\d{7}\b/g }],

  // Poland
  [PIIEntity.PL_PESEL]: [{ regex: /\b\d{11}\b/g }],

  // Singapore
  [PIIEntity.SG_NRIC_FIN]: [{ regex: /\b[A-Z]\d{7}[A-Z]\b/g }],
  [PIIEntity.SG_UEN]: [{ regex: /\b\d{8}[A-Z]\b|\b\d{9}[A-Z]\b/g }],

  // Australia
  [PIIEntity.AU_ABN]: [{ regex: /\b\d{2} \d{3} \d{3} \d{3}\b/g }],
  [PIIEntity.AU_ACN]: [{ regex: /\b\d{3} \d{3} \d{3}\b/g }],
  [PIIEntity.AU_TFN]: [{ regex: /\b\d{9}\b/g }],
  [PIIEntity.AU_MEDICARE]: [{ regex: /\b\d{4} \d{5} \d{1}\b/g }],

  // India
  [PIIEntity.IN_PAN]: [{ regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g }],
  [PIIEntity.IN_AADHAAR]: [{ regex: /\b\d{4} \d{4} \d{4}\b/g }],
  [PIIEntity.IN_VEHICLE_REGISTRATION]: [{ regex: /\b[A-Z]{2}\d{2}[A-Z]{2}\d{4}\b/g }],
  [PIIEntity.IN_VOTER]: [{ regex: /\b[A-Z]{3}\d{7}\b/g }],
  [PIIEntity.IN_PASSPORT]: [{ regex: /\b[A-Z]\d{7}\b/g }],

  // Finland
  [PIIEntity.FI_PERSONAL_IDENTITY_CODE]: [{ regex: /\b\d{6}[+-A]\d{3}[A-Z0-9]\b/g }],

  // Korea
  // Format: YYMMDD-GNNNNNN where YY=year, MM=month(01-12), DD=day(01-31), G=gender/century(1-4)
  [PIIEntity.KR_RRN]: [{ regex: /\b\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])-[1-4]\d{6}\b/g }],
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

  const normalizedText = _normalizeUnicode(text);
  const plainDetection = _collectPlainDetections(normalizedText, config.entities);

  let encodedMapping: Record<string, Set<string>> = {};
  let encodedSpans: ReplacementSpan[] = [];

  if (config.detect_encoded_pii) {
    const encodedDetection = _detectEncodedPii(normalizedText, config);
    encodedMapping = encodedDetection.mapping;
    encodedSpans = encodedDetection.spans;
  }

  return {
    normalizedText,
    plainMapping: plainDetection.mapping,
    encodedMapping,
    spans: [...plainDetection.spans, ...encodedSpans],
  };
}

function _normalizeUnicode(text: string): string {
  if (!text) {
    return text;
  }
  try {
    return text.normalize('NFKC').replace(ZERO_WIDTH_CHARACTERS, '');
  } catch {
    return text.replace(ZERO_WIDTH_CHARACTERS, '');
  }
}

function _collectPlainDetections(
  text: string,
  entities: PIIEntity[]
): { mapping: Record<string, Set<string>>; spans: ReplacementSpan[] } {
  const mapping: Record<string, Set<string>> = {};
  const spans: ReplacementSpan[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const definitions = DEFAULT_PII_PATTERNS[entity];
    if (!definitions || !definitions.length) {
      continue;
    }

    for (const definition of definitions) {
      const regex = new RegExp(definition.regex.source, definition.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const groupIndex = definition.group ?? 0;
        const matchedValue = match[groupIndex];
        if (!matchedValue) {
          if (regex.lastIndex === match.index) {
            regex.lastIndex += 1;
          }
          continue;
        }

        const extracted = matchedValue.trim();
        if (!extracted) {
          if (regex.lastIndex === match.index) {
            regex.lastIndex += 1;
          }
          continue;
        }

        const relativeIndex = definition.group != null ? match[0].indexOf(matchedValue) : 0;
        const start = match.index + relativeIndex;
        const end = start + matchedValue.length;
        const spanKey = `${entity}:${start}:${end}`;

        if (seen.has(spanKey)) {
          if (regex.lastIndex === match.index) {
            regex.lastIndex += 1;
          }
          continue;
        }

        seen.add(spanKey);

        if (!mapping[entity]) {
          mapping[entity] = new Set();
        }
        mapping[entity]!.add(extracted);

        spans.push({
          start,
          end,
          entityType: entity,
          replacement: `<${entity}>`,
          priority: 2,
        });

        if (regex.lastIndex === match.index) {
          regex.lastIndex += 1;
        }
      }
    }
  }

  return { mapping, spans };
}

function _detectEncodedPii(
  text: string,
  config: PIIConfig
): { mapping: Record<string, Set<string>>; spans: ReplacementSpan[] } {
  const candidates = _findEncodedCandidates(text);
  if (!candidates.length) {
    return { mapping: {}, spans: [] };
  }

  const mapping: Record<string, Set<string>> = {};
  const spans: ReplacementSpan[] = [];

  for (const candidate of candidates) {
    const decoded = candidate.decodedText;
    if (!decoded) {
      continue;
    }

    const normalized = _normalizeUnicode(decoded);
    const detection = _collectPlainDetections(normalized, config.entities);

    const matchedEntities = Object.entries(detection.mapping)
      .filter(([, values]) => values && values.size)
      .map(([entity]) => entity);

    if (!matchedEntities.length) {
      continue;
    }

    for (const entity of matchedEntities) {
      if (!mapping[entity]) {
        mapping[entity] = new Set();
      }
      mapping[entity]!.add(candidate.encodedText);
    }

    const preferredEntity = _selectPreferredEntity(matchedEntities, config.entities);
    spans.push({
      start: candidate.start,
      end: candidate.end,
      entityType: preferredEntity,
      replacement: `<${preferredEntity}_ENCODED>`,
      priority: 1,
    });
  }

  return { mapping, spans };
}

function _findEncodedCandidates(text: string): EncodedCandidate[] {
  const candidates: EncodedCandidate[] = [];
  const seen = new Set<string>();

  const addCandidate = (
    start: number,
    end: number,
    encodedText: string,
    decodedText: string,
    type: EncodedCandidate['type']
  ) => {
    const key = `${start}:${end}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ start, end, encodedText, decodedText, type });
  };

  const hexRegex = new RegExp(HEX_PATTERN.source, HEX_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = hexRegex.exec(text)) !== null) {
    const raw = match[0];
    if (raw.length % 2 !== 0) {
      continue;
    }
    const decoded = _tryDecodeHex(raw);
    if (decoded === null) {
      continue;
    }
    const start = match.index;
    const end = start + raw.length;
    addCandidate(start, end, raw, decoded, 'hex');
  }

  const base64Regex = new RegExp(BASE64_PATTERN.source, BASE64_PATTERN.flags);
  while ((match = base64Regex.exec(text)) !== null) {
    const captured = match[1] ?? match[0];
    if (captured.length % 4 !== 0) {
      continue;
    }
    if (/^[0-9a-fA-F]+$/.test(captured) && !captured.includes('=')) {
      // Likely hex - already handled.
      continue;
    }
    const relativeIndex = match[1] ? match[0].indexOf(match[1]) : 0;
    const start = match.index + relativeIndex;
    const end = start + captured.length;
    const decoded = _tryDecodeBase64(captured);
    if (decoded === null) {
      continue;
    }
    addCandidate(start, end, captured, decoded, 'base64');
  }

  const urlRegex = new RegExp(URL_ENCODED_PATTERN.source, URL_ENCODED_PATTERN.flags);
  while ((match = urlRegex.exec(text)) !== null) {
    const raw = match[0];
    if (raw.length < 9) {
      continue;
    }
    let start = match.index;
    let end = start + raw.length;
    while (end < text.length && /[A-Za-z0-9._@-]/.test(text[end])) {
      end += 1;
    }
    const candidateText = text.slice(start, end);
    const decoded = _tryDecodeUrl(candidateText);
    if (decoded === null) {
      continue;
    }
    addCandidate(start, end, candidateText, decoded, 'url');
  }

  return candidates;
}

function _selectPreferredEntity(matchedEntities: string[], priorityOrder: PIIEntity[]): string {
  for (const entity of priorityOrder) {
    if (matchedEntities.includes(entity)) {
      return entity;
    }
  }
  return matchedEntities[0];
}

function _mergeDetectionSets(
  plain: Record<string, Set<string>>,
  encoded: Record<string, Set<string>>
): Record<string, Set<string>> {
  const merged: Record<string, Set<string>> = {};

  for (const [entity, values] of Object.entries(plain)) {
    if (!values || values.size === 0) {
      continue;
    }
    merged[entity] = new Set(values);
  }

  for (const [entity, values] of Object.entries(encoded)) {
    if (!values || values.size === 0) {
      continue;
    }
    if (!merged[entity]) {
      merged[entity] = new Set();
    }
    for (const value of values) {
      merged[entity]!.add(value);
    }
  }

  return merged;
}

function _convertSetsToArrays(mapping: Record<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [entity, values] of Object.entries(mapping)) {
    if (!values || values.size === 0) {
      continue;
    }
    result[entity] = Array.from(values);
  }
  return result;
}

function _dedupeReplacements(replacements: ReplacementSpan[]): ReplacementSpan[] {
  if (!replacements.length) {
    return [];
  }

  const sorted = [...replacements].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    const aLength = a.end - a.start;
    const bLength = b.end - b.start;
    if (bLength !== aLength) {
      return bLength - aLength;
    }
    return a.start - b.start;
  });

  const accepted: ReplacementSpan[] = [];

  for (const span of sorted) {
    const overlaps = accepted.some((existing) => span.start < existing.end && span.end > existing.start);
    if (!overlaps) {
      accepted.push(span);
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}

function _applyReplacements(text: string, replacements: ReplacementSpan[]): string {
  let offset = 0;
  let result = text;

  for (const span of replacements) {
    const start = span.start + offset;
    const end = span.end + offset;
    result = `${result.slice(0, start)}${span.replacement}${result.slice(end)}`;
    offset += span.replacement.length - (span.end - span.start);
  }

  return result;
}

function _tryDecodeBase64(text: string): string | null {
  const sanitized = text.replace(/\s+/g, '');
  if (!sanitized || sanitized.length % 4 !== 0) {
    return null;
  }
  if (/[^A-Za-z0-9+/=]/.test(sanitized)) {
    return null;
  }

  try {
    const buffer = Buffer.from(sanitized, 'base64');
    if (buffer.length > MAX_DECODED_BYTES) {
      throw new Error(`Base64 decoded content too large (${buffer.length} bytes). Maximum allowed is 10KB.`);
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Maximum allowed')) {
      throw error;
    }
    return null;
  }
}

function _tryDecodeHex(text: string): string | null {
  if (!text || text.length % 2 !== 0) {
    return null;
  }
  try {
    const buffer = Buffer.from(text, 'hex');
    if (buffer.length > MAX_DECODED_BYTES) {
      throw new Error(`Hex decoded content too large (${buffer.length} bytes). Maximum allowed is 10KB.`);
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Maximum allowed')) {
      throw error;
    }
    return null;
  }
}

function _tryDecodeUrl(text: string): string | null {
  if (!text.includes('%')) {
    return null;
  }

  try {
    const normalized = text.replace(/\+/g, '%20');
    const decoded = decodeURIComponent(normalized);
    const encoder = new TextEncoder();
    const length = encoder.encode(decoded).length;
    if (length > MAX_DECODED_BYTES) {
      throw new Error(`URL decoded content too large (${length} bytes). Maximum allowed is 10KB.`);
    }
    return decoded;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Maximum allowed')) {
      throw error;
    }
    return null;
  }
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
function _scrubPii(originalText: string, detection: PiiDetectionResult): string {
  if (!originalText) {
    throw new Error('Text cannot be empty or null');
  }

  if (!detection.spans.length) {
    return originalText;
  }

  const replacements = _dedupeReplacements(detection.spans);
  return _applyReplacements(detection.normalizedText, replacements);
}

/**
 * Convert detection results to a GuardrailResult for reporting.
 *
 * @param detection Results of the PII scan
 * @param config Original detection configuration
 * @param name Name for the guardrail in result metadata
 * @param text Original input text for scrubbing
 * @returns Includes masked text and respects block setting for tripwire
 */
function _asResult(
  detection: PiiDetectionResult,
  config: PIIConfig,
  name: string,
  text: string
): GuardrailResult {
  const mergedMapping = _mergeDetectionSets(detection.plainMapping, detection.encodedMapping);
  const detectedEntities = _convertSetsToArrays(mergedMapping);
  const hasPii = Object.keys(detectedEntities).length > 0;

  const checkedText = hasPii ? _scrubPii(text, detection) : text;

  return {
    // Only trigger tripwire if block=true AND PII is found
    tripwireTriggered: config.block && hasPii,
    info: {
      guardrail_name: name,
      detected_entities: detectedEntities,
      entity_types_checked: config.entities,
      checked_text: checkedText,
      block_mode: config.block,
      pii_detected: hasPii,
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
