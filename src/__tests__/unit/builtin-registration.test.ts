import { beforeEach, describe, expect, it, vi } from 'vitest';

const expectedOrder = [
  'Keyword Filter',
  'URL Filter',
  'Moderation',
  'Contains PII',
  'NSFW Text',
  'Hallucination Detection',
  'Competitors',
  'Jailbreak',
  'Secret Keys',
  'Off Topic Prompts',
  'Custom Prompt Check',
  'Prompt Injection Detection',
];

describe('built-in registration order', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ['checks barrel', () => import('../../checks')],
    ['package entry point', () => import('../../index')],
  ] as const)('preserves catalog order through the %s', async (_name, load) => {
    await load();
    const { defaultSpecRegistry } = await import('../../registry');

    expect(defaultSpecRegistry.all().map((spec) => spec.name)).toEqual(expectedOrder);
    expect(defaultSpecRegistry.metadata().map((metadata) => metadata.name)).toEqual(expectedOrder);
    expect(defaultSpecRegistry.get_all().map((spec) => spec.name)).toEqual(expectedOrder);
    expect(defaultSpecRegistry.get_all_metadata().map((metadata) => metadata.name)).toEqual(
      expectedOrder
    );
  });
});
