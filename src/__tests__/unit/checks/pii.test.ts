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

  it('normalizes fullwidth characters for email detection', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
    });
    const text = 'Contact: test＠example.com';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.EMAIL_ADDRESS).toEqual(['test@example.com']);
    expect(result.info?.checked_text).toBe('Contact: <EMAIL_ADDRESS>');
  });

  it('detects phone numbers with zero-width spaces', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.PHONE_NUMBER],
      block: false,
    });
    const text = 'Call 212\u200B-555\u200B-1234';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.PHONE_NUMBER).toEqual(['212-555-1234']);
    expect(result.info?.checked_text).toBe('Call <PHONE_NUMBER>');
  });

  it('detects base64 encoded PII when enabled', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
      detect_encoded_pii: true,
    });
    const text = 'Base64 PII: am9obkBleGFtcGxlLmNvbQ==';

    const result = await pii({}, text, config);

    expect(result.tripwireTriggered).toBe(false);
    expect((result.info?.detected_entities as Record<string, string[]>)?.EMAIL_ADDRESS).toEqual([
      'am9obkBleGFtcGxlLmNvbQ==',
    ]);
    expect(result.info?.checked_text).toBe('Base64 PII: <EMAIL_ADDRESS_ENCODED>');
  });

  it('detects URL encoded PII when enabled', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
      detect_encoded_pii: true,
    });
    const text = 'Encoded %6a%61%6e%65%40securemail.net email';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.EMAIL_ADDRESS).toEqual([
      '%6a%61%6e%65%40securemail.net',
    ]);
    expect(result.info?.checked_text).toBe('Encoded <EMAIL_ADDRESS_ENCODED> email');
  });

  it('detects hex encoded PII when enabled', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
      detect_encoded_pii: true,
    });
    const text = 'Hex 6a6f686e406578616d706c652e636f6d string';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.EMAIL_ADDRESS).toEqual([
      '6a6f686e406578616d706c652e636f6d',
    ]);
    expect(result.info?.checked_text).toBe('Hex <EMAIL_ADDRESS_ENCODED> string');
  });

  it('does not detect encoded PII when detection is disabled', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
      detect_encoded_pii: false,
    });
    const text = 'Base64 PII: am9obkBleGFtcGxlLmNvbQ==';

    const result = await pii({}, text, config);

    expect(result.info?.detected_entities).toEqual({});
    expect(result.info?.checked_text).toBe(text);
  });

  it('detects CVV codes in free text', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.CVV],
      block: false,
    });
    const text = 'Credit card CVC 274 exp 12/28';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.CVV).toEqual(['274']);
    expect(result.info?.checked_text).toBe('Credit card CVC <CVV> exp 12/28');
  });

  it('detects CVV codes with equals syntax', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.CVV],
      block: false,
    });
    const text = 'cvv=533';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.CVV).toEqual(['533']);
    expect(result.info?.checked_text).toBe('cvv=<CVV>');
  });

  it('detects BIC/SWIFT codes', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.BIC_SWIFT],
      block: false,
    });
    const text = 'Transfer to BIC DEXXDEXX tomorrow.';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.BIC_SWIFT).toEqual(['DEXXDEXX']);
    expect(result.info?.checked_text).toBe('Transfer to BIC <BIC_SWIFT> tomorrow.');
  });

  it('detects precise street addresses as location', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.LOCATION],
      block: false,
    });
    const text = 'Ship to 782 Maple Ridge Ave, Austin, TX for delivery.';

    const result = await pii({}, text, config);

    expect((result.info?.detected_entities as Record<string, string[]>)?.LOCATION).toContain(
      '782 Maple Ridge Ave, Austin, TX'
    );
    expect(result.info?.checked_text).toBe('Ship to <LOCATION> for delivery.');
  });
});
