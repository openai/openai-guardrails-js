/**
 * Core types and protocols for guardrail evaluation.
 *
 * This module defines the core data models and protocols used throughout the guardrail evaluation framework.
 * It includes types for evaluation samples, results, metrics, and interfaces for dataset loading,
 * evaluation engines, metrics calculation, and reporting.
 */

import { OpenAI } from 'openai';

/**
 * A single evaluation sample.
 */
export interface Sample {
  /** Unique identifier for the sample. */
  id: string;
  /** The text or data to be evaluated. */
  data: string;
  /** Mapping of guardrail names to expected trigger status (true/false). */
  expectedTriggers: Record<string, boolean>;
}

/**
 * Raw sample data that may come from JSONL files with different field naming conventions.
 */
export interface RawSample {
  /** Unique identifier for the sample. */
  id: string;
  /** The text or data to be evaluated. */
  data: string;
  /** Mapping of guardrail names to expected trigger status (true/false). */
  expectedTriggers?: Record<string, boolean>;
  /** Alternative snake_case field name for compatibility with existing datasets. */
  expected_triggers?: Record<string, boolean>;
}

/**
 * Result of evaluating a single sample.
 */
export interface SampleResult {
  /** Unique identifier for the sample. */
  id: string;
  /** Mapping of guardrail names to expected trigger status. */
  expectedTriggers: Record<string, boolean>;
  /** Mapping of guardrail names to actual trigger status. */
  triggered: Record<string, boolean>;
  /** Additional details for each guardrail (e.g., info, errors). */
  details: Record<string, unknown>;
}

/**
 * Metrics for a guardrail evaluation.
 */
export interface GuardrailMetrics {
  /** Number of true positives. */
  truePositives: number;
  /** Number of false positives. */
  falsePositives: number;
  /** Number of false negatives. */
  falseNegatives: number;
  /** Number of true negatives. */
  trueNegatives: number;
  /** Total number of samples evaluated. */
  totalSamples: number;
  /** Precision score. */
  precision: number;
  /** Recall score. */
  recall: number;
  /** F1 score. */
  f1Score: number;
}

/**
 * Context with LLM client for guardrail evaluation.
 */
export interface Context {
  /** Asynchronous OpenAI client for LLM-based guardrails. */
  guardrailLlm: OpenAI;
}

/**
 * Protocol for dataset loading and validation.
 */
export interface DatasetLoader {
  /**
   * Load and validate dataset from path.
   *
   * @param path - Path to the dataset file.
   * @returns List of validated samples.
   */
  load(path: string): Promise<Sample[]>;
}

/**
 * Protocol for running guardrail evaluations.
 */
export interface RunEngine {
  /**
   * Run evaluation on a list of samples.
   *
   * @param context - Evaluation context.
   * @param samples - List of samples to evaluate.
   * @param batchSize - Number of samples to process in parallel.
   * @param desc - Description for progress reporting.
   * @returns List of sample results.
   */
  run(
    context: Context,
    samples: Sample[],
    batchSize: number,
    desc?: string
  ): Promise<SampleResult[]>;
}

/**
 * Protocol for calculating evaluation metrics.
 */
export interface MetricsCalculator {
  /**
   * Calculate metrics from sample results.
   *
   * @param results - List of sample results.
   * @returns Dictionary mapping guardrail names to their metrics.
   */
  calculate(results: SampleResult[]): Record<string, GuardrailMetrics>;
}

/**
 * Protocol for reporting evaluation results.
 */
export interface ResultsReporter {
  /**
   * Save results and metrics to output directory.
   *
   * @param results - List of sample results.
   * @param metrics - Dictionary of guardrail metrics.
   * @param outputDir - Directory to save results and metrics.
   */
  save(
    results: SampleResult[],
    metrics: Record<string, GuardrailMetrics>,
    outputDir: string
  ): Promise<void>;
}
