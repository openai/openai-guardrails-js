/**
 * Latency testing for guardrail benchmarking.
 *
 * This module implements end-to-end guardrail latency testing for different models.
 */

import { Context, Sample } from './types';
import { AsyncRunEngine } from './async-engine';
import { instantiateGuardrails, GuardrailBundle } from '../../runtime';

/**
 * Tests end-to-end guardrail latency for different models.
 */
export class LatencyTester {
  private readonly iterations: number;

  /**
   * Initialize the latency tester.
   *
   * @param iterations - Number of samples to time per model
   */
  constructor(iterations: number = 20) {
    this.iterations = iterations;
  }

  /**
   * Calculate latency statistics from a list of times.
   *
   * @param times - List of latency times in seconds
   * @returns Dictionary with P50, P95, mean, and std dev (in milliseconds)
   */
  calculateLatencyStats(times: number[]): Record<string, number> {
    if (times.length === 0) {
      return { p50: NaN, p95: NaN, mean: NaN, std: NaN };
    }

    const timesMs = times.map((t) => t * 1000); // Convert to milliseconds
    const sorted = [...timesMs].sort((a, b) => a - b);

    const p50 = this.percentile(sorted, 50);
    const p95 = this.percentile(sorted, 95);
    const mean = timesMs.reduce((a, b) => a + b, 0) / timesMs.length;
    const variance = timesMs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / timesMs.length;
    const std = Math.sqrt(variance);

    return {
      p50,
      p95,
      mean,
      std,
    };
  }

  /**
   * Measure end-to-end guardrail latency per sample for a single model.
   *
   * @param context - Evaluation context with LLM client
   * @param stageBundle - Stage bundle configured for the specific model
   * @param samples - Full dataset samples
   * @param iterations - Number of samples to time (uses first N samples)
   * @param desc - Optional progress bar description
   * @returns Dictionary with latency statistics and raw times
   */
  async testGuardrailLatencyForModel(
    context: Context,
    stageBundle: GuardrailBundle,
    samples: Sample[],
    iterations: number,
    desc?: string
  ): Promise<Record<string, unknown>> {
    const guardrails = await instantiateGuardrails(stageBundle);
    const engine = new AsyncRunEngine(guardrails);

    const num = Math.min(iterations, samples.length);
    if (num <= 0) {
      return this.emptyLatencyResult();
    }

    const ttcTimes: number[] = [];
    const barDesc = desc || 'Latency';

    console.log(`${barDesc}: ${num} samples`);

    for (let i = 0; i < num; i += 1) {
      const sample = samples[i];
      const start = performance.now() / 1000; // Convert to seconds
      await engine.run(context, [sample], 1, undefined);
      const ttc = performance.now() / 1000 - start;
      ttcTimes.push(ttc);
      console.log(`${barDesc}: Processed ${i + 1}/${num} samples`);
    }

    const ttcStats = this.calculateLatencyStats(ttcTimes);

    return {
      ttft: ttcStats, // TTFT same as TTC at guardrail level
      ttc: ttcStats,
      rawTimes: { ttft: ttcTimes, ttc: ttcTimes },
      iterations: ttcTimes.length,
    };
  }

  private emptyLatencyResult(): Record<string, unknown> {
    const emptyStats = { p50: NaN, p95: NaN, mean: NaN, std: NaN };
    return {
      ttft: emptyStats,
      ttc: emptyStats,
      rawTimes: { ttft: [], ttc: [] },
      iterations: 0,
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) {
      return NaN;
    }
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}

