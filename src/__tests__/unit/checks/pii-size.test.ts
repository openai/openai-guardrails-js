import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIIConfig, PIIEntity, pii } from '../../../checks/pii';

const fixtures = [
  { encoding: 'base64', text: 'aGVsbG8gd29ybGQh' },
  { encoding: 'hex', text: '68656c6c6f20776f726c642121' },
  { encoding: 'url', text: '%68%65%6c%6c%6f' },
];

// Exercise size handling with small inert candidates, without oversized inputs.
function mockDecodedSize(encoding: string, size: number): void {
  if (encoding === 'url') {
    vi.spyOn(TextEncoder.prototype, 'encode').mockReturnValueOnce(new Uint8Array(size));
  } else {
    vi.spyOn(Buffer, 'from').mockReturnValueOnce(Buffer.alloc(size, 'x'));
  }
}

afterEach(() => vi.restoreAllMocks());

describe.each(fixtures)('$encoding analysis size limit', ({ encoding, text }) => {
  it.each([false, true])('retains plaintext findings and blocks with block=%s', async (block) => {
    mockDecodedSize(encoding, 10_001);
    const result = await pii(
      {},
      `john@example.com ${text}`,
      PIIConfig.parse({
        entities: [PIIEntity.EMAIL_ADDRESS],
        block,
        detect_encoded_pii: true,
      })
    );
    expect(result.tripwireTriggered).toBe(true);
    expect(result.executionFailed).not.toBe(true);
    expect(result.info).toMatchObject({
      detected_entities: { EMAIL_ADDRESS: ['john@example.com'] },
      checked_text: `<EMAIL_ADDRESS> ${text}`,
      pii_detected: true,
      block_mode: block,
      encoded_analysis_incomplete: true,
      error: expect.stringContaining('Maximum allowed'),
    });
  });

  it('blocks incomplete analysis even without plaintext PII', async () => {
    mockDecodedSize(encoding, 10_001);
    const result = await pii(
      {},
      text,
      PIIConfig.parse({
        entities: [PIIEntity.EMAIL_ADDRESS],
        detect_encoded_pii: true,
      })
    );
    expect(result.tripwireTriggered).toBe(true);
    expect(result.info).toMatchObject({
      detected_entities: {},
      pii_detected: false,
      encoded_analysis_incomplete: true,
    });
  });

  it('accepts analysis at the size limit', async () => {
    mockDecodedSize(encoding, 10_000);
    const result = await pii(
      {},
      `john@example.com ${text}`,
      PIIConfig.parse({
        entities: [PIIEntity.EMAIL_ADDRESS],
        detect_encoded_pii: true,
      })
    );
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.checked_text).toBe(`<EMAIL_ADDRESS> ${text}`);
    expect(result.info).not.toHaveProperty('encoded_analysis_incomplete');
  });

  it('preserves default disabled encoded detection and plaintext masking', async () => {
    const result = await pii(
      {},
      `john@example.com ${text}`,
      PIIConfig.parse({ entities: [PIIEntity.EMAIL_ADDRESS] })
    );
    expect(result.tripwireTriggered).toBe(false);
    expect(result.info?.checked_text).toBe(`<EMAIL_ADDRESS> ${text}`);
    expect(result.info).not.toHaveProperty('encoded_analysis_incomplete');
  });
});
