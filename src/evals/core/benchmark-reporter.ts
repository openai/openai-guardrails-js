/**
 * Benchmark results reporter for guardrail evaluation.
 *
 * This module handles saving benchmark results in a specialized format with analysis
 * folders containing visualizations and detailed metrics.
 */

import { SampleResult } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Reports benchmark results with specialized output format.
 */
export class BenchmarkReporter {
  private readonly outputDir: string;

  /**
   * Initialize the benchmark reporter.
   *
   * @param outputDir - Base directory for benchmark results
   */
  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Save benchmark results in organized folder structure.
   *
   * @param resultsByModel - Dictionary mapping model names to their results
   * @param metricsByModel - Dictionary mapping model names to their metrics
   * @param latencyResults - Dictionary mapping model names to their latency data
   * @param guardrailName - Name of the guardrail being benchmarked
   * @param datasetSize - Number of samples in the dataset
   * @param latencyIterations - Number of iterations used for latency testing
   * @returns Path to the benchmark results directory
   */
  async saveBenchmarkResults(
    resultsByModel: Record<string, SampleResult[]>,
    metricsByModel: Record<string, Record<string, number>>,
    latencyResults: Record<string, Record<string, unknown>>,
    guardrailName: string,
    datasetSize: number,
    latencyIterations: number
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19).replace('T', '_');
    const benchmarkDir = path.join(this.outputDir, `benchmark_${guardrailName}_${timestamp}`);

    await fs.mkdir(benchmarkDir, { recursive: true });

    // Create subdirectories
    const resultsDir = path.join(benchmarkDir, 'results');
    const graphsDir = path.join(benchmarkDir, 'graphs');
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.mkdir(graphsDir, { recursive: true });

    try {
      // Save per-model results
      for (const [modelName, results] of Object.entries(resultsByModel)) {
        const modelResultsFile = path.join(
          resultsDir,
          `eval_results_${guardrailName}_${modelName}.jsonl`
        );
        await this.saveResultsJsonl(results, modelResultsFile);
        console.info(`Model ${modelName} results saved to ${modelResultsFile}`);
      }

      // Save combined data
      await this.saveMetricsJson(metricsByModel, path.join(resultsDir, 'performance_metrics.json'));
      await this.saveLatencyJson(latencyResults, path.join(resultsDir, 'latency_results.json'));

      // Save summary files
      const summaryFile = path.join(benchmarkDir, 'benchmark_summary.txt');
      await this.saveBenchmarkSummary(
        summaryFile,
        guardrailName,
        resultsByModel,
        metricsByModel,
        latencyResults,
        datasetSize,
        latencyIterations
      );

      await this.saveSummaryTables(benchmarkDir, metricsByModel, latencyResults);
    } catch (error) {
      console.error(`Failed to save benchmark results: ${error}`);
      throw error;
    }

    console.info(`Benchmark results saved to: ${benchmarkDir}`);
    return benchmarkDir;
  }

  private createPerformanceTable(
    metricsByModel: Record<string, Record<string, number>>
  ): string[][] {
    if (Object.keys(metricsByModel).length === 0) {
      return [];
    }

    const metricKeys = ['precision', 'recall', 'f1Score', 'roc_auc'];
    const metricNames = ['Precision', 'Recall', 'F1 Score', 'ROC AUC'];

    const table: string[][] = [];
    const header = ['Model', ...metricNames];
    table.push(header);

    for (const [modelName, modelMetrics] of Object.entries(metricsByModel)) {
      const row: string[] = [modelName];
      for (const key of metricKeys) {
        const value = modelMetrics[key];
        if (value === undefined || isNaN(value)) {
          row.push('N/A');
        } else {
          row.push(value.toFixed(4));
        }
      }
      table.push(row);
    }

    return table;
  }

  private createLatencyTable(latencyResults: Record<string, Record<string, unknown>>): string[][] {
    if (Object.keys(latencyResults).length === 0) {
      return [];
    }

    const table: string[][] = [];
    const header = ['Model', 'TTC P50 (ms)', 'TTC P95 (ms)'];
    table.push(header);

    for (const [modelName, modelLatency] of Object.entries(latencyResults)) {
      const row: string[] = [modelName];

      if ('ttc' in modelLatency && typeof modelLatency.ttc === 'object' && modelLatency.ttc !== null) {
        const ttcData = modelLatency.ttc as Record<string, unknown>;
        const p50 = ttcData.p50;
        const p95 = ttcData.p95;

        row.push(
          typeof p50 === 'number' && !isNaN(p50) ? p50.toFixed(1) : 'N/A',
          typeof p95 === 'number' && !isNaN(p95) ? p95.toFixed(1) : 'N/A'
        );
      } else {
        row.push('N/A', 'N/A');
      }

      table.push(row);
    }

    return table;
  }

  private formatTable(table: string[][]): string {
    if (table.length === 0) {
      return 'No data available';
    }

    // Calculate column widths
    const widths: number[] = [];
    for (let col = 0; col < table[0].length; col += 1) {
      let maxWidth = 0;
      for (const row of table) {
        if (row[col]) {
          maxWidth = Math.max(maxWidth, row[col].length);
        }
      }
      widths.push(maxWidth);
    }

    // Format rows
    const lines: string[] = [];
    for (const row of table) {
      const formattedRow = row
        .map((cell, i) => (cell || '').padEnd(widths[i] || 0))
        .join('  ');
      lines.push(formattedRow);
    }

    return lines.join('\n');
  }

  private async saveSummaryTables(
    benchmarkDir: string,
    metricsByModel: Record<string, Record<string, number>>,
    latencyResults: Record<string, Record<string, unknown>>
  ): Promise<void> {
    const outputFile = path.join(benchmarkDir, 'benchmark_summary_tables.txt');

    try {
      const perfTable = this.createPerformanceTable(metricsByModel);
      const latencyTable = this.createLatencyTable(latencyResults);

      let content = 'BENCHMARK SUMMARY TABLES\n';
      content += '='.repeat(80) + '\n\n';

      content += 'PERFORMANCE METRICS\n';
      content += '-'.repeat(80) + '\n';
      content += perfTable.length > 0 ? this.formatTable(perfTable) : 'No data available';
      content += '\n\n';

      content += 'LATENCY RESULTS (Time to Completion)\n';
      content += '-'.repeat(80) + '\n';
      content += latencyTable.length > 0 ? this.formatTable(latencyTable) : 'No data available';
      content += '\n\n';

      await fs.writeFile(outputFile, content, 'utf-8');
      console.info(`Summary tables saved to: ${outputFile}`);
    } catch (error) {
      console.error(`Failed to save summary tables: ${error}`);
    }
  }

  private async saveResultsJsonl(results: SampleResult[], filepath: string): Promise<void> {
    const lines = results.map((result) =>
      JSON.stringify({
        id: result.id,
        expected_triggers: result.expectedTriggers,
        triggered: result.triggered,
        details: result.details || {},
      })
    );
    await fs.writeFile(filepath, lines.join('\n'), 'utf-8');
  }

  private async saveMetricsJson(
    metricsByModel: Record<string, Record<string, number>>,
    filepath: string
  ): Promise<void> {
    await fs.writeFile(filepath, JSON.stringify(metricsByModel, null, 2), 'utf-8');
  }

  private async saveLatencyJson(
    latencyResults: Record<string, Record<string, unknown>>,
    filepath: string
  ): Promise<void> {
    await fs.writeFile(filepath, JSON.stringify(latencyResults, null, 2), 'utf-8');
  }

  private async saveBenchmarkSummary(
    filepath: string,
    guardrailName: string,
    resultsByModel: Record<string, SampleResult[]>,
    metricsByModel: Record<string, Record<string, number>>,
    latencyResults: Record<string, Record<string, unknown>>,
    datasetSize: number,
    latencyIterations: number
  ): Promise<void> {
    let content = 'Guardrail Benchmark Results\n';
    content += '===========================\n\n';
    content += `Guardrail: ${guardrailName}\n`;
    content += `Timestamp: ${new Date().toISOString()}\n`;
    content += `Dataset size: ${datasetSize} samples\n`;
    content += `Latency iterations: ${latencyIterations}\n\n`;

    content += `Models evaluated: ${Object.keys(resultsByModel).join(', ')}\n\n`;

    content += 'Performance Metrics Summary:\n';
    content += '---------------------------\n';
    for (const [modelName, metrics] of Object.entries(metricsByModel)) {
      content += `\n${modelName}:\n`;
      for (const [metricName, value] of Object.entries(metrics)) {
        if (typeof value === 'number' && !isNaN(value)) {
          content += `  ${metricName}: ${value}\n`;
        } else {
          content += `  ${metricName}: N/A\n`;
        }
      }
    }

    content += '\nLatency Summary:\n';
    content += '----------------\n';
    for (const [modelName, latencyData] of Object.entries(latencyResults)) {
      content += `\n${modelName}:\n`;
      if ('error' in latencyData) {
        content += `  Error: ${latencyData.error}\n`;
      } else {
        const ttft = latencyData.ttft as Record<string, number> | undefined;
        const ttc = latencyData.ttc as Record<string, number> | undefined;
        if (ttft && ttc) {
          content += `  TTFT P50: ${ttft.p50?.toFixed(1) || 'N/A'}ms, P95: ${ttft.p95?.toFixed(1) || 'N/A'}ms\n`;
          content += `  TTC P50: ${ttc.p50?.toFixed(1) || 'N/A'}ms, P95: ${ttc.p95?.toFixed(1) || 'N/A'}ms\n`;
        }
      }
    }

    await fs.writeFile(filepath, content, 'utf-8');
  }
}

