import { GuardrailTripwireTriggered } from '../exceptions';
import { GuardrailResult } from '../types';

type GuardrailFailure =
  { kind: 'execution'; error: Error } | { kind: 'tripwire'; error: GuardrailTripwireTriggered };

/** Classify results before throwing so execution errors retain their provenance. */
export function getGuardrailFailure(
  results: GuardrailResult[],
  suppressTripwire: boolean,
  raiseGuardrailErrors: boolean
): GuardrailFailure | undefined {
  if (raiseGuardrailErrors) {
    const failure = results.find((result) => result.executionFailed);
    if (failure) {
      return {
        kind: 'execution',
        error: failure.originalException ?? new Error('Guardrail execution failed'),
      };
    }
  }

  if (!suppressTripwire) {
    const violation = results.find((result) => result.tripwireTriggered);
    if (violation) {
      return { kind: 'tripwire', error: new GuardrailTripwireTriggered(violation) };
    }
  }
  return undefined;
}
