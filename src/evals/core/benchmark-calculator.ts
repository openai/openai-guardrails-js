/**
 * Advanced metrics calculator for guardrail benchmarking.
 *
 * This module implements advanced evaluation metrics for benchmarking guardrail performance
 * across different models.
 */

import { SampleResult } from './types';

/**
 * Calculates advanced benchmarking metrics for guardrail evaluation.
 */
export class BenchmarkMetricsCalculator {
  /**
   * Calculate advanced metrics for a specific guardrail.
   *
   * @param results - List of evaluation results
   * @param guardrailName - Name of the guardrail to analyze
   * @param guardrailConfig - Guardrail configuration to check for confidence thresholds
   * @returns Dictionary containing advanced metrics, or empty dict if not applicable
   */
  calculateAdvancedMetrics(
    results: SampleResult[],
    guardrailName: string,
    guardrailConfig?: Record<string, unknown> | null
  ): Record<string, number> {
    if (!guardrailConfig || !('confidence_threshold' in guardrailConfig)) {
      return {};
    }

    if (results.length === 0) {
      throw new Error('Cannot calculate metrics for empty results list');
    }

    const { yTrue, yScores } = this.extractLabelsAndScores(results, guardrailName);

    if (yTrue.length === 0) {
      throw new Error(`No valid data found for guardrail '${guardrailName}'`);
    }

    return this.calculateMetrics(yTrue, yScores);
  }

  private extractLabelsAndScores(
    results: SampleResult[],
    guardrailName: string
  ): { yTrue: number[]; yScores: number[] } {
    const yTrue: number[] = [];
    const yScores: number[] = [];

    for (const result of results) {
      if (!(guardrailName in result.expectedTriggers)) {
        console.warn(
          `Guardrail '${guardrailName}' not found in expectedTriggers for sample ${result.id}`
        );
        continue;
      }

      const expected = result.expectedTriggers[guardrailName];
      yTrue.push(expected ? 1 : 0);

      // Get confidence score from details, fallback to binary
      const confidence = this.getConfidenceScore(result, guardrailName);
      yScores.push(confidence);
    }

    return { yTrue, yScores };
  }

  private getConfidenceScore(result: SampleResult, guardrailName: string): number {
    if (guardrailName in result.details) {
      const guardrailDetails = result.details[guardrailName];
      if (
        typeof guardrailDetails === 'object' &&
        guardrailDetails !== null &&
        'confidence' in guardrailDetails
      ) {
        const conf = guardrailDetails.confidence;
        if (typeof conf === 'number') {
          return conf;
        }
      }
    }

    // Fallback to binary: 1.0 if triggered, 0.0 if not
    const actual = result.triggered[guardrailName] || false;
    return actual ? 1.0 : 0.0;
  }

  private calculateMetrics(yTrue: number[], yScores: number[]): Record<string, number> {
    const metrics: Record<string, number> = {};

    // Calculate ROC AUC
    try {
      metrics.roc_auc = this.calculateRocAuc(yTrue, yScores);
    } catch (error) {
      console.warn(`Could not calculate ROC AUC: ${error}`);
      metrics.roc_auc = NaN;
    }

    // Calculate precision at different recall thresholds
    try {
      const { precision, recall } = this.precisionRecallCurve(yTrue, yScores);
      metrics.prec_at_r80 = this.precisionAtRecall(precision, recall, 0.8);
      metrics.prec_at_r90 = this.precisionAtRecall(precision, recall, 0.9);
      metrics.prec_at_r95 = this.precisionAtRecall(precision, recall, 0.95);
    } catch (error) {
      console.warn(`Could not calculate precision at recall thresholds: ${error}`);
      metrics.prec_at_r80 = NaN;
      metrics.prec_at_r90 = NaN;
      metrics.prec_at_r95 = NaN;
    }

    // Calculate recall at FPR = 0.01
    try {
      const { fpr, tpr } = this.rocCurve(yTrue, yScores);
      metrics.recall_at_fpr01 = this.recallAtFpr(fpr, tpr, 0.01);
    } catch (error) {
      console.warn(`Could not calculate recall at FPR=0.01: ${error}`);
      metrics.recall_at_fpr01 = NaN;
    }

    return metrics;
  }

  private calculateRocAuc(yTrue: number[], yScores: number[]): number {
    // Sort by score descending
    const combined = yTrue.map((label, i) => ({ label, score: yScores[i] }));
    combined.sort((a, b) => b.score - a.score);

    const totalPositives = yTrue.filter((y) => y === 1).length;
    const totalNegatives = yTrue.length - totalPositives;

    if (totalPositives === 0 || totalNegatives === 0) {
      throw new Error('Need both positive and negative samples to calculate ROC AUC');
    }

    let auc = 0;
    let tp = 0;
    let fp = 0;
    let prevTpr = 0;
    let prevFpr = 0;

    for (const item of combined) {
      if (item.label === 1) {
        tp += 1;
      } else {
        fp += 1;
      }

      const tpr = tp / totalPositives;
      const fpr = fp / totalNegatives;

      // Trapezoidal rule
      auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;

      prevTpr = tpr;
      prevFpr = fpr;
    }

    return auc;
  }

  private precisionRecallCurve(yTrue: number[], yScores: number[]): {
    precision: number[];
    recall: number[];
  } {
    // Sort by score descending
    const combined = yTrue.map((label, i) => ({ label, score: yScores[i] }));
    combined.sort((a, b) => b.score - a.score);

    const totalPositives = yTrue.filter((y) => y === 1).length;
    if (totalPositives === 0) {
      return { precision: [1], recall: [0] };
    }

    const precision: number[] = [];
    const recall: number[] = [];

    let tp = 0;
    let fp = 0;

    // Add initial point (recall=0, precision=1)
    precision.push(1);
    recall.push(0);

    for (const item of combined) {
      if (item.label === 1) {
        tp += 1;
      } else {
        fp += 1;
      }

      const prec = tp + fp > 0 ? tp / (tp + fp) : 1;
      const rec = tp / totalPositives;

      precision.push(prec);
      recall.push(rec);
    }

    return { precision, recall };
  }

  private rocCurve(yTrue: number[], yScores: number[]): { fpr: number[]; tpr: number[] } {
    // Sort by score descending
    const combined = yTrue.map((label, i) => ({ label, score: yScores[i] }));
    combined.sort((a, b) => b.score - a.score);

    const totalPositives = yTrue.filter((y) => y === 1).length;
    const totalNegatives = yTrue.length - totalPositives;

    const fpr: number[] = [0];
    const tpr: number[] = [0];

    let tp = 0;
    let fp = 0;

    for (const item of combined) {
      if (item.label === 1) {
        tp += 1;
      } else {
        fp += 1;
      }

      tpr.push(tp / totalPositives);
      fpr.push(fp / totalNegatives);
    }

    return { fpr, tpr };
  }

  private precisionAtRecall(precision: number[], recall: number[], targetRecall: number): number {
    let bestPrecision = 0;

    for (let i = 0; i < recall.length; i += 1) {
      if (recall[i] >= targetRecall) {
        bestPrecision = Math.max(bestPrecision, precision[i]);
      }
    }

    return bestPrecision;
  }

  private recallAtFpr(fpr: number[], tpr: number[], targetFpr: number): number {
    let bestRecall = 0;

    for (let i = 0; i < fpr.length; i += 1) {
      if (fpr[i] <= targetFpr) {
        bestRecall = Math.max(bestRecall, tpr[i]);
      }
    }

    return bestRecall;
  }

  /**
   * Calculate advanced metrics for all guardrails in the results.
   *
   * @param results - List of evaluation results
   * @returns Dictionary mapping guardrail names to their advanced metrics
   */
  calculateAllGuardrailMetrics(
    results: SampleResult[]
  ): Record<string, Record<string, number>> {
    if (results.length === 0) {
      return {};
    }

    const guardrailNames = new Set<string>();
    for (const result of results) {
      Object.keys(result.expectedTriggers).forEach((name) => guardrailNames.add(name));
    }

    const metrics: Record<string, Record<string, number>> = {};

    for (const guardrailName of guardrailNames) {
      try {
        const guardrailMetrics = this.calculateAdvancedMetrics(results, guardrailName);
        metrics[guardrailName] = guardrailMetrics;
      } catch (error) {
        console.error(`Failed to calculate metrics for guardrail '${guardrailName}': ${error}`);
        metrics[guardrailName] = {
          roc_auc: NaN,
          prec_at_r80: NaN,
          prec_at_r90: NaN,
          prec_at_r95: NaN,
          recall_at_fpr01: NaN,
        };
      }
    }

    return metrics;
  }
}

