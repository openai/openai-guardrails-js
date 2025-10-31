/**
 * Unit tests for the PII guardrail functionality.
 */

import { describe, it, expect } from 'vitest';
import { pii, PIIConfig, PIIEntity } from '../../../checks/pii';

describe('pii guardrail', () => {
  it('masks detected PII when block=false', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS, PIIEntity.US_SSN],
      block: false,
    });
    const text = 'Contact john@example.com SSN: 111-22-3333';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.EMAIL_ADDRESS).toEqual(['john@example.com']);
    expect((result.info?.detected_entities as Record<string, string[]>)?.US_SSN).toEqual(['111-22-3333']);
    expect(result.info?.checked_text).toBe('Contact <EMAIL_ADDRESS> SSN: <US_SSN>');
  });

  it('triggers tripwire when block=true', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.PHONE_NUMBER],
      block: true,
    });

    const result = await pii({}, 'Call me at (415) 123-4567', config);

    expect(result.tripwireTriggered).toBe(true);
    expect((result.info?.detected_entities as Record<string, string[]>)?.PHONE_NUMBER?.[0]).toContain('415');
    expect(result.info?.checked_text).toContain('<PHONE_NUMBER>');
  });

  it('throws on empty input', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
    });

    await expect(pii({}, '', config)).rejects.toThrow('Text cannot be empty or null');
  });

  it('detects valid Korean Resident Registration Number (KR_RRN)', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.KR_RRN],
      block: false,
    });
    // Valid format: YYMMDD-GNNNNNN (900101 = Jan 1, 1990, gender digit 1)
    const text = 'Korean RRN: 900101-1234567';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toEqual(['900101-1234567']);
    expect(result.info?.checked_text).toBe('Korean RRN: <KR_RRN>');
  });

  it('detects multiple valid KR_RRN formats', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.KR_RRN],
      block: false,
    });
    // Testing different valid date ranges and gender digits (1-4)
    const text = 'RRNs: 850315-2345678, 001231-3456789, 750628-4123456';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toHaveLength(3);
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toContain('850315-2345678');
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toContain('001231-3456789');
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toContain('750628-4123456');
  });

  it('does not detect invalid KR_RRN patterns (false positives)', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.KR_RRN],
      block: false,
    });
    // Invalid patterns that should NOT be detected:
    // - Invalid month (13)
    // - Invalid day (00, 32)
    // - Invalid gender digit (0, 5, 9)
    // - Random tracking numbers
    const text = 'Invalid: 901301-1234567, 900100-1234567, 900132-1234567, 900101-0234567, 900101-5234567, 123456-7890123';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.detected_entities).toEqual({});
    expect(result.info?.checked_text).toBe(text); // No masking should occur
  });

  it('triggers tripwire for KR_RRN when block=true', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.KR_RRN],
      block: true,
    });
    const text = 'Korean RRN: 900101-1234567';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(true);
    expect((result.info?.detected_entities as Record<string, string[]>)?.KR_RRN).toEqual(['900101-1234567']);
  });
});
