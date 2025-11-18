/**
 * Unit tests for guardrail evaluation utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GuardrailEval } from '../../../evals/guardrail-evals';
import type { Sample } from '../../../evals/core/types';
import * as os from 'os';

vi.mock('os', () => {
  return {
    default: {
      cpus: vi.fn(),
    },
    cpus: vi.fn(),
  };
});

function buildSamples(count: number): Sample[] {
  /**Build synthetic samples for chunking tests.
   *
   * @param count - Number of synthetic samples to build.
   * @returns List of Sample instances configured for evaluation.
   */
  return Array.from({ length: count }, (_, idx) => ({
    id: `sample-${idx}`,
    data: `payload-${idx}`,
    expectedTriggers: { g: Boolean(idx % 2) },
  }));
}

describe('GuardrailEval._determineParallelModelLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should use cpu_count when explicit parallelism is not provided', () => {
    vi.mocked(os.cpus).mockReturnValue(Array(4).fill({}) as os.CpuInfo[]);

    expect(GuardrailEval._determineParallelModelLimit(10, null)).toBe(4);
    expect(GuardrailEval._determineParallelModelLimit(2, null)).toBe(2);
  });

  it('should honor user-provided parallelism constraints', () => {
    expect(GuardrailEval._determineParallelModelLimit(5, 3)).toBe(3);
    expect(() => GuardrailEval._determineParallelModelLimit(5, 0)).toThrow('maxParallelModels must be positive');
  });

  it('should throw error for invalid model count', () => {
    expect(() => GuardrailEval._determineParallelModelLimit(0, null)).toThrow('modelCount must be positive');
  });
});

describe('GuardrailEval._chunkSamples', () => {
  it('should return the original sample list when no chunk size is provided', () => {
    const samples = buildSamples(3);
    const chunks = Array.from(GuardrailEval._chunkSamples(samples, null));
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(samples);
  });

  it('should split samples into evenly sized chunks', () => {
    const samples = buildSamples(5);
    const chunks = Array.from(GuardrailEval._chunkSamples(samples, 2));
    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 2, 1]);
    expect(chunks[0][0].id).toBe('sample-0');
    expect(chunks[1][0].id).toBe('sample-2');
    expect(chunks[2][0].id).toBe('sample-4');
  });

  it('should reject invalid chunk sizes', () => {
    const samples = buildSamples(2);
    expect(() => Array.from(GuardrailEval._chunkSamples(samples, 0))).toThrow('chunkSize must be positive when provided');
  });

  it('should return single chunk when chunk size is larger than samples', () => {
    const samples = buildSamples(3);
    const chunks = Array.from(GuardrailEval._chunkSamples(samples, 10));
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(samples);
  });

  it('should handle empty samples', () => {
    const samples: Sample[] = [];
    const chunks = Array.from(GuardrailEval._chunkSamples(samples, 2));
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual([]);
  });
});

