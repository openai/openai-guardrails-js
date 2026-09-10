/**
 * Metrics calculator for guardrail evaluation.
 *
 * This module implements precision, recall, and F1-score calculation for guardrail evaluation results.
 * It provides a calculator class for aggregating metrics across samples.
 */

import type { GuardrailMetrics, MetricsCalculator, SampleResult } from './types';

/**
 * Calculates evaluation metrics from results.
 */
export class GuardrailMetricsCalculator implements MetricsCalculator {
  /**
   * Calculate precision, recall, and F1 score for each guardrail.
   *
   * @param results - Sequence of evaluation results
   * @returns Dictionary mapping guardrail names to their metrics
   *
   * @throws {Error} If results list is empty
   */
  calculate(results: SampleResult[]): Record<string, GuardrailMetrics> {
    if (results.length === 0) {
      throw new Error('Cannot calculate metrics for empty results list');
    }

    // Get guardrail names from first result
    const guardrailNames = Object.keys(results[0].triggered);

    const metrics: Record<string, GuardrailMetrics> = {};

    for (const name of guardrailNames) {
      // Calculate metrics
      const truePositives = results.filter(
        (r) => r.expectedTriggers[name] && r.triggered[name]
      ).length;

      const falsePositives = results.filter(
        (r) => !r.expectedTriggers[name] && r.triggered[name]
      ).length;

      const falseNegatives = results.filter(
        (r) => r.expectedTriggers[name] && !r.triggered[name]
      ).length;

      const trueNegatives = results.filter(
        (r) => !r.expectedTriggers[name] && !r.triggered[name]
      ).length;

      const total = truePositives + falsePositives + falseNegatives + trueNegatives;
      if (total !== results.length) {
        console.error(`Metrics sum mismatch for ${name}: ${total} != ${results.length}`);
        throw new Error(`Metrics sum mismatch for ${name}`);
      }

      // Calculate precision, recall, and F1
      const precision =
        truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0.0;

      const recall =
        truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0.0;

      const f1Score =
        precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0.0;

      metrics[name] = {
        truePositives,
        falsePositives,
        falseNegatives,
        trueNegatives,
        totalSamples: total,
        precision,
        recall,
        f1Score,
      };
    }

    return metrics;
  }
}
