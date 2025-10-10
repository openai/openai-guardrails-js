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
    expect(result.info?.detected_entities?.EMAIL_ADDRESS).toEqual(['john@example.com']);
    expect(result.info?.detected_entities?.US_SSN).toEqual(['111-22-3333']);
    expect(result.info?.checked_text).toBe('Contact <EMAIL_ADDRESS> SSN: <US_SSN>');
  });

  it('triggers tripwire when block=true', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.PHONE_NUMBER],
      block: true,
    });

    const result = await pii({}, 'Call me at (415) 123-4567', config);

    expect(result.tripwireTriggered).toBe(true);
    expect(result.info?.detected_entities?.PHONE_NUMBER?.[0]).toContain('415');
    expect(result.info?.checked_text).toContain('<PHONE_NUMBER>');
  });

  it('throws on empty input', async () => {
    const config = PIIConfig.parse({
      entities: [PIIEntity.EMAIL_ADDRESS],
      block: false,
    });

    await expect(pii({}, '', config)).rejects.toThrow('Text cannot be empty or null');
  });
});
