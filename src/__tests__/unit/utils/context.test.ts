/**
 * Tests for guardrail context utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  validateGuardrailContext,
  ContextValidationError,
  hasProperty,
  hasRequiredProperties,
} from '../../../utils/context';

describe('validateGuardrailContext', () => {
  const guardrail = {
    definition: {
      name: 'Test Guardrail',
      ctxRequirements: {
        guardrailLlm: { required: true },
        optionalValue: { required: false },
      },
    },
  };

  it('passes when required properties exist', () => {
    expect(() =>
      validateGuardrailContext(guardrail, { guardrailLlm: {}, optionalValue: 1 })
    ).not.toThrow();
  });

  it('throws ContextValidationError when required property is missing', () => {
    expect(() => validateGuardrailContext(guardrail, {})).toThrow(ContextValidationError);
  });

  it('throws informative error when context is not introspectable', () => {
    expect(() => validateGuardrailContext(guardrail, null as unknown as any)).toThrow(
      /Context must support property access/
    );
  });
});

describe('hasProperty helpers', () => {
  it('hasProperty returns true when prop exists', () => {
    const obj = { key: 'value' };
    expect(hasProperty(obj, 'key')).toBe(true);
  });

  it('hasRequiredProperties ensures all props exist', () => {
    const obj = { first: 1, second: 2 };
    expect(hasRequiredProperties(obj, ['first', 'second'])).toBe(true);
    expect(hasRequiredProperties(obj, ['first', 'third'])).toBe(false);
  });
});
