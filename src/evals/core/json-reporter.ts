/**
 * JSON results reporter for guardrail evaluation.
 *
 * This module implements a reporter that saves evaluation results and metrics in JSON and JSONL formats.
 * It provides a class for writing results to disk for further analysis or sharing.
 */

import type { GuardrailMetrics, ResultsReporter, SampleResult } from './types';

/**
 * Reports evaluation results in JSON format.
 */
export class JsonResultsReporter implements ResultsReporter {
  /**
   * Save evaluation results to files.
   *
   * @param results - List of evaluation results
   * @param metrics - Dictionary of guardrail metrics
   * @param outputDir - Directory to save results
   *
   * @throws {Error} If there are any file I/O errors
   * @throws {Error} If results or metrics are empty
   */
  async save(
    results: SampleResult[],
    metrics: Record<string, GuardrailMetrics>,
    outputDir: string
  ): Promise<void> {
    if (results.length === 0) {
      throw new Error('Cannot save empty results list');
    }
    if (Object.keys(metrics).length === 0) {
      throw new Error('Cannot save empty metrics dictionary');
    }

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      // Create output directory if it doesn't exist
      await fs.mkdir(outputDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      // Save per-sample results
      const resultsFile = path.join(outputDir, `eval_results_${timestamp}.jsonl`);
      await this.writeResults(resultsFile, results);

      // Save metrics
      const metricsFile = path.join(outputDir, `eval_metrics_${timestamp}.json`);
      await fs.writeFile(metricsFile, JSON.stringify(metrics, null, 2), 'utf-8');

      console.info(`Results saved to ${resultsFile}`);
      console.info(`Metrics saved to ${metricsFile}`);
    } catch (error) {
      console.error('Failed to save results:', error);
      throw error;
    }
  }

  /**
   * Write results to file in JSONL format.
   *
   * @param filePath - Path to the file to write to
   * @param results - List of results to write
   */
  private async writeResults(filePath: string, results: SampleResult[]): Promise<void> {
    const fs = await import('node:fs/promises');

    const lines = results.map((result) => JSON.stringify(result));
    await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
  }
}
