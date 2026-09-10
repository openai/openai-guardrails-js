/**
 * Exception types for Guardrails.
 *
 * This module provides custom error classes for guardrail-related errors.
 */

import type { GuardrailResult } from './types';

/**
 * Base class for all guardrail-related errors.
 */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailError';
  }
}

/**
 * Exception raised when a guardrail tripwire is triggered.
 *
 * This exception indicates that a guardrail check has identified
 * a critical failure that should prevent further processing.
 */
export class GuardrailTripwireTriggered extends GuardrailError {
  public readonly guardrailResult: GuardrailResult;

  constructor(guardrailResult: GuardrailResult) {
    const message = `Guardrail tripwire triggered: ${guardrailResult.info?.guardrail_name || 'Unknown'}`;
    super(message);
    this.name = 'GuardrailTripwireTriggered';
    this.guardrailResult = guardrailResult;
  }
}

/**
 * Exception raised when there's an issue with guardrail configuration.
 */
export class GuardrailConfigurationError extends GuardrailError {
  constructor(message: string) {
    super(message);
    this.name = 'GuardrailConfigurationError';
  }
}

/**
 * Exception raised when a guardrail check function is not found.
 */
export class GuardrailNotFoundError extends GuardrailError {
  constructor(name: string) {
    super(`Guardrail '${name}' not found`);
    this.name = 'GuardrailNotFoundError';
  }
}

/**
 * Exception raised when there's an issue with guardrail execution.
 */
export class GuardrailExecutionError extends GuardrailError {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'GuardrailExecutionError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
