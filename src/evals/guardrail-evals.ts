/**
 * Guardrail evaluation runner.
 *
 * This class provides the main interface for running guardrail evaluations on datasets.
 * It loads guardrail configurations, runs evaluations asynchronously, calculates metrics, and saves results.
 */

import { Context, Sample } from './core/types';
import { JsonlDatasetLoader } from './core/jsonl-loader';
import { AsyncRunEngine } from './core/async-engine';
import { GuardrailMetricsCalculator } from './core/calculator';
import { JsonResultsReporter } from './core/json-reporter';
import { loadConfigBundleFromFile, instantiateGuardrails } from '../runtime';
import { OpenAI } from 'openai';
import * as os from 'os';

/**
 * Class for running guardrail evaluations.
 */
export class GuardrailEval {
  private configPath: string;
  private datasetPath: string;
  private batchSize: number;
  private outputDir: string;
  private multiTurn: boolean;
  private maxParallelModels: number;
  private benchmarkChunkSize: number | null;

  /**
   * Initialize the evaluator.
   *
   * @param configPath - Path to the guardrail config file
   * @param datasetPath - Path to the evaluation dataset
   * @param batchSize - Number of samples to process in parallel
   * @param outputDir - Directory to save evaluation results
   * @param multiTurn - Whether to evaluate guardrails on multi-turn conversations
   * @param maxParallelModels - Maximum number of models to benchmark concurrently
   * @param benchmarkChunkSize - Optional sample chunk size for per-model benchmarking
   */
  constructor(
    configPath: string,
    datasetPath: string,
    batchSize: number = 32,
    outputDir: string = 'results',
    multiTurn: boolean = false,
    maxParallelModels?: number | null,
    benchmarkChunkSize?: number | null
  ) {
    this.configPath = configPath;
    this.datasetPath = datasetPath;
    this.batchSize = batchSize;
    this.outputDir = outputDir;
    this.multiTurn = multiTurn;
    this.maxParallelModels = maxParallelModels ?? 1;
    this.benchmarkChunkSize = benchmarkChunkSize ?? null;

    this._validateInputs(maxParallelModels, benchmarkChunkSize);
  }

  /**
   * Validate input parameters.
   */
  private _validateInputs(
    maxParallelModels?: number | null,
    benchmarkChunkSize?: number | null
  ): void {
    if (maxParallelModels !== null && maxParallelModels !== undefined && maxParallelModels <= 0) {
      throw new Error(`max_parallel_models must be positive, got: ${maxParallelModels}`);
    }

    if (benchmarkChunkSize !== null && benchmarkChunkSize !== undefined && benchmarkChunkSize <= 0) {
      throw new Error(`benchmark_chunk_size must be positive, got: ${benchmarkChunkSize}`);
    }
  }

  /**
   * Resolve the number of benchmark tasks that can run concurrently.
   *
   * @param modelCount - Total number of models scheduled for benchmarking
   * @param requestedLimit - Optional user-provided parallelism limit
   * @returns Number of concurrent benchmark tasks to run
   */
  static _determineParallelModelLimit(modelCount: number, requestedLimit?: number | null): number {
    if (modelCount <= 0) {
      throw new Error('model_count must be positive');
    }

    if (requestedLimit !== null && requestedLimit !== undefined) {
      if (requestedLimit <= 0) {
        throw new Error('max_parallel_models must be positive');
      }
      return Math.min(requestedLimit, modelCount);
    }

    const cpuCount = os.cpus().length || 1;
    return Math.max(1, Math.min(cpuCount, modelCount));
  }

  /**
   * Yield contiguous sample chunks respecting the configured chunk size.
   *
   * @param samples - Samples to evaluate
   * @param chunkSize - Optional maximum chunk size to enforce
   * @returns Iterator yielding slices of the provided samples
   */
  static *_chunkSamples(samples: Sample[], chunkSize?: number | null): Generator<Sample[], void, unknown> {
    if (chunkSize !== null && chunkSize !== undefined && chunkSize <= 0) {
      throw new Error('chunk_size must be positive when provided');
    }

    if (!samples || samples.length === 0 || chunkSize === null || chunkSize === undefined || chunkSize >= samples.length) {
      yield samples;
      return;
    }

    for (let start = 0; start < samples.length; start += chunkSize) {
      yield samples.slice(start, start + chunkSize);
    }
  }

  /**
   * Run the evaluation pipeline.
   *
   * @param desc - Description for the evaluation process
   */
  async run(desc: string = 'Evaluating samples'): Promise<void> {
    // Load/validate config, instantiate guardrails
    const bundle = await loadConfigBundleFromFile(this.configPath);
    const guardrails = await instantiateGuardrails(bundle);

    // Load and validate dataset
    const loader = new JsonlDatasetLoader();
    const samples = await loader.load(this.datasetPath);

    // Initialize components
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'OPENAI_API_KEY environment variable is required. Please set it with: export OPENAI_API_KEY="your-api-key-here"'
      );
    }

    const openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const context: Context = { guardrailLlm: openaiClient };
    const engine = new AsyncRunEngine(guardrails, this.multiTurn);
    const calculator = new GuardrailMetricsCalculator();
    const reporter = new JsonResultsReporter();

    // Run evaluations
    const results = await engine.run(context, samples, this.batchSize, desc);

    // Calculate metrics
    const metrics = calculator.calculate(results);

    // Save results
    await reporter.save(results, metrics, this.outputDir);
  }
}

/**
 * CLI entry point for running evaluations.
 *
 * @param args - Command line arguments
 */
export async function runEvaluationCLI(args: {
  configPath: string;
  datasetPath: string;
  batchSize?: number;
  outputDir?: string;
  multiTurn?: boolean;
  maxParallelModels?: number | null;
  benchmarkChunkSize?: number | null;
}): Promise<void> {
  const evaluator = new GuardrailEval(
    args.configPath,
    args.datasetPath,
    args.batchSize || 32,
    args.outputDir || 'results',
    Boolean(args.multiTurn),
    args.maxParallelModels,
    args.benchmarkChunkSize
  );

  await evaluator.run();
}
