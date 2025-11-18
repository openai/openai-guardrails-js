/**
 * Guardrail evaluation runner and CLI.
 *
 * This script provides a command-line interface and class for running guardrail evaluations on datasets.
 */

import { Context, Sample, SampleResult } from './core/types';
import { JsonlDatasetLoader } from './core/jsonl-loader';
import { AsyncRunEngine } from './core/async-engine';
import { GuardrailMetricsCalculator } from './core/calculator';
import { JsonResultsReporter } from './core/json-reporter';
import { BenchmarkMetricsCalculator } from './core/benchmark-calculator';
import { BenchmarkReporter } from './core/benchmark-reporter';
import { BenchmarkVisualizer } from './core/visualizer';
import { LatencyTester } from './core/latency-tester';
import {
  instantiateGuardrails,
  loadPipelineBundles,
  PipelineConfig,
  GuardrailBundle,
} from '../runtime';
import { OpenAI } from 'openai';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';

// Default models for benchmark mode
const DEFAULT_BENCHMARK_MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini'];
const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_LATENCY_ITERATIONS = 25;
const VALID_STAGES = new Set(['pre_flight', 'input', 'output']);

/**
 * Class for running guardrail evaluations.
 */
export class GuardrailEval {
  private configPath: string;
  private datasetPath: string;
  private stages: string[] | null;
  private batchSize: number;
  private outputDir: string;
  private apiKey: string | null;
  private baseUrl: string | null;
  private azureEndpoint: string | null;
  private azureApiVersion: string;
  private mode: 'evaluate' | 'benchmark';
  private models: string[];
  private latencyIterations: number;
  private multiTurn: boolean;
  private maxParallelModels: number;
  private benchmarkChunkSize: number | null;

  /**
   * Initialize the evaluator.
   *
   * @param configPath - Path to pipeline configuration file
   * @param datasetPath - Path to evaluation dataset (JSONL)
   * @param stages - Specific stages to evaluate (pre_flight, input, output)
   * @param batchSize - Number of samples to process in parallel
   * @param outputDir - Directory to save evaluation results
   * @param apiKey - API key for OpenAI, Azure OpenAI, or OpenAI-compatible API
   * @param baseUrl - Base URL for OpenAI-compatible API (e.g., http://localhost:11434/v1)
   * @param azureEndpoint - Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)
   * @param azureApiVersion - Azure OpenAI API version (e.g., 2025-01-01-preview)
   * @param mode - Evaluation mode ("evaluate" or "benchmark")
   * @param models - Models to test in benchmark mode
   * @param latencyIterations - Number of iterations for latency testing
   * @param multiTurn - Whether to evaluate guardrails on multi-turn conversations
   * @param maxParallelModels - Maximum number of models to benchmark concurrently
   * @param benchmarkChunkSize - Optional sample chunk size for per-model benchmarking
   */
  constructor(
    configPath: string,
    datasetPath: string,
    stages: string[] | null = null,
    batchSize: number = DEFAULT_BATCH_SIZE,
    outputDir: string = 'results',
    apiKey: string | null = null,
    baseUrl: string | null = null,
    azureEndpoint: string | null = null,
    azureApiVersion: string = '2025-01-01-preview',
    mode: 'evaluate' | 'benchmark' = 'evaluate',
    models: string[] | null = null,
    latencyIterations: number = DEFAULT_LATENCY_ITERATIONS,
    multiTurn: boolean = false,
    maxParallelModels: number | null = null,
    benchmarkChunkSize: number | null = null
  ) {
    // Note: File existence validation will happen in run() method
    // since constructor cannot be async
    if (batchSize <= 0) {
      throw new Error(`Batch size must be positive, got: ${batchSize}`);
    }

    if (mode !== 'evaluate' && mode !== 'benchmark') {
      throw new Error(`Invalid mode: ${mode}. Must be 'evaluate' or 'benchmark'`);
    }

    if (latencyIterations <= 0) {
      throw new Error(`Latency iterations must be positive, got: ${latencyIterations}`);
    }

    if (maxParallelModels !== null && maxParallelModels <= 0) {
      throw new Error(`max_parallel_models must be positive, got: ${maxParallelModels}`);
    }

    if (benchmarkChunkSize !== null && benchmarkChunkSize <= 0) {
      throw new Error(`benchmark_chunk_size must be positive, got: ${benchmarkChunkSize}`);
    }

    this.configPath = configPath;
    this.datasetPath = datasetPath;
    this.stages = stages;
    this.batchSize = batchSize;
    this.outputDir = outputDir;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.azureEndpoint = azureEndpoint;
    this.azureApiVersion = azureApiVersion;
    this.mode = mode;
    this.models = models || [...DEFAULT_BENCHMARK_MODELS];
    this.latencyIterations = latencyIterations;
    this.multiTurn = multiTurn;
    this.maxParallelModels = GuardrailEval._determineParallelModelLimit(
      this.models.length,
      maxParallelModels
    );
    this.benchmarkChunkSize = benchmarkChunkSize;
  }

  private async _validateFilePaths(): Promise<void> {
    try {
      await fs.access(this.configPath);
    } catch {
      throw new Error(`Config file not found: ${this.configPath}`);
    }

    try {
      await fs.access(this.datasetPath);
    } catch {
      throw new Error(`Dataset file not found: ${this.datasetPath}`);
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
      throw new Error('modelCount must be positive');
    }

    if (requestedLimit !== null && requestedLimit !== undefined) {
      if (requestedLimit <= 0) {
        throw new Error('maxParallelModels must be positive');
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
   * @returns Generator yielding slices of the provided samples
   */
  static *_chunkSamples(samples: Sample[], chunkSize?: number | null): Generator<Sample[], void, unknown> {
    if (chunkSize !== null && chunkSize !== undefined && chunkSize <= 0) {
      throw new Error('chunkSize must be positive when provided');
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
   * Run the evaluation pipeline for all specified stages.
   */
  async run(): Promise<void> {
    await this._validateFilePaths();
    try {
      if (this.mode === 'benchmark') {
        await this._runBenchmark();
      } else {
        await this._runEvaluation();
      }
    } catch (error) {
      console.error(`Evaluation failed: ${error}`);
      throw error;
    }
  }

  private async _runEvaluation(): Promise<void> {
    const pipelineBundles = await loadPipelineBundles(this.configPath);
    const stagesToEvaluate = this._getValidStages(pipelineBundles);

    if (stagesToEvaluate.length === 0) {
      throw new Error('No valid stages found in configuration');
    }

    console.info(`event="evaluation_start" stages="${stagesToEvaluate.join(', ')}" mode="evaluate"`);

    const loader = new JsonlDatasetLoader();
    const samples = await loader.load(this.datasetPath);
    console.info(`Loaded ${samples.length} samples from dataset`);

    const context = this._createContext();
    const calculator = new GuardrailMetricsCalculator();
    const reporter = new JsonResultsReporter();

    const allResults: Record<string, SampleResult[]> = {};
    const allMetrics: Record<string, Record<string, unknown>> = {};

    for (const stage of stagesToEvaluate) {
      console.info(`Starting ${stage} stage evaluation`);

      try {
        const stageResults = await this._evaluateSingleStage(
          stage,
          pipelineBundles,
          samples,
          context,
          calculator
        );

        if (stageResults) {
          allResults[stage] = stageResults.results;
          allMetrics[stage] = stageResults.metrics;
          console.info(`Completed ${stage} stage evaluation`);
        } else {
          console.warn(`Stage '${stage}' evaluation returned no results`);
        }
      } catch (error) {
        console.error(`Failed to evaluate stage '${stage}': ${error}`);
      }
    }

    if (Object.keys(allResults).length === 0) {
      throw new Error('No stages were successfully evaluated');
    }

    // Note: JsonResultsReporter.save_multi_stage would need to be implemented
    // For now, save each stage separately
    for (const [stage, results] of Object.entries(allResults)) {
      const stageMetrics = allMetrics[stage] as ReturnType<typeof calculator.calculate>;
      await reporter.save(results, stageMetrics, this.outputDir);
    }

    console.info(`Evaluation completed. Results saved to: ${this.outputDir}`);
  }

  private async _runBenchmark(): Promise<void> {
    console.info(`event="benchmark_start" duration_ms=0 models="${this.models.join(', ')}"`);
    console.info(
      `event="benchmark_parallel_config" duration_ms=0 parallel_limit=${this.maxParallelModels} chunk_size=${
        this.benchmarkChunkSize || 'dataset'
      } batch_size=${this.batchSize}`
    );

    const pipelineBundles = await loadPipelineBundles(this.configPath);
    const { stageToTest, guardrailName } = this._getBenchmarkTarget(pipelineBundles);

    // Validate guardrail has model configuration
    const stageBundle = (pipelineBundles as Record<string, GuardrailBundle>)[stageToTest];
    if (!this._hasModelConfiguration(stageBundle)) {
      throw new Error(
        `Guardrail '${guardrailName}' does not have a model configuration. ` +
          'Benchmark mode requires LLM-based guardrails with configurable models.'
      );
    }

    console.info(`event="benchmark_target" duration_ms=0 guardrail="${guardrailName}" stage="${stageToTest}"`);

    const loader = new JsonlDatasetLoader();
    const samples = await loader.load(this.datasetPath);
    console.info(`event="benchmark_samples_loaded" duration_ms=0 count=${samples.length}`);

    const context = this._createContext();
    const benchmarkCalculator = new BenchmarkMetricsCalculator();
    const basicCalculator = new GuardrailMetricsCalculator();
    const benchmarkReporter = new BenchmarkReporter(this.outputDir);

    // Run benchmark for all models
    const { resultsByModel, metricsByModel } = await this._benchmarkAllModels(
      stageToTest,
      guardrailName,
      samples,
      context,
      benchmarkCalculator,
      basicCalculator,
      pipelineBundles
    );

    // Run latency testing
    console.info(`event="benchmark_latency_start" duration_ms=0 model_count=${this.models.length}`);
    const latencyResults = await this._runLatencyTests(stageToTest, samples, pipelineBundles);

    // Save benchmark results
    const benchmarkDir = await benchmarkReporter.saveBenchmarkResults(
      resultsByModel,
      metricsByModel,
      latencyResults,
      guardrailName,
      samples.length,
      this.latencyIterations
    );

    // Create visualizations
    console.info(`event="benchmark_visualization_start" duration_ms=0 guardrail="${guardrailName}"`);
    const visualizer = new BenchmarkVisualizer(path.join(benchmarkDir, 'graphs'));
    const visualizationFiles = await visualizer.createAllVisualizations(
      resultsByModel,
      metricsByModel,
      latencyResults,
      guardrailName,
      samples[0]?.expectedTriggers || {}
    );

    console.info(`event="benchmark_complete" duration_ms=0 output="${benchmarkDir}"`);
    console.info(`event="benchmark_visualization_complete" duration_ms=0 count=${visualizationFiles.length}`);
  }

  private _hasModelConfiguration(stageBundle: GuardrailBundle | undefined): boolean {
    if (!stageBundle || !stageBundle.guardrails || stageBundle.guardrails.length === 0) {
      return false;
    }

    const guardrailConfig = stageBundle.guardrails[0]?.config;
    if (!guardrailConfig) {
      return false;
    }

    if (typeof guardrailConfig === 'object' && 'model' in guardrailConfig) {
      return true;
    }

    return false;
  }

  private async _runLatencyTests(
    stageToTest: string,
    samples: Sample[],
    pipelineBundles: PipelineConfig
  ): Promise<Record<string, Record<string, unknown>>> {
    const latencyResults: Record<string, Record<string, unknown>> = {};
    const latencyTester = new LatencyTester(this.latencyIterations);

    for (const model of this.models) {
      const stageBundle = (pipelineBundles as Record<string, GuardrailBundle>)[stageToTest];
      const modelStageBundle = this._createModelSpecificStageBundle(stageBundle, model);
      const modelContext = this._createContext();
      latencyResults[model] = await latencyTester.testGuardrailLatencyForModel(
        modelContext,
        modelStageBundle,
        samples,
        this.latencyIterations,
        `Testing latency: ${model}`
      );
    }

    return latencyResults;
  }

  private _createContext(): Context {
    // Azure OpenAI
    if (this.azureEndpoint) {
      // Validate API key availability
      const apiKey = this.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'API key is required for Azure OpenAI. Please provide --api-key or set OPENAI_API_KEY environment variable.'
        );
      }

      const azureKwargs: Record<string, string> = {
        azureEndpoint: this.azureEndpoint,
        apiVersion: this.azureApiVersion,
      };
      if (this.apiKey) {
        azureKwargs.apiKey = this.apiKey;
      }

      // Note: Azure OpenAI client creation would need AzureOpenAI import
      // For now, fall back to regular OpenAI with base URL
    const openaiClient = new OpenAI({
        apiKey: apiKey,
        baseURL: `https://${this.azureEndpoint.replace(/^https?:\/\//, '')}/openai/deployments`,
      });
      console.info(`event="client_created" type="azure" endpoint="${this.azureEndpoint}"`);
      return { guardrailLlm: openaiClient };
    }
    // OpenAI or OpenAI-compatible API
    else {
      const openaiKwargs: Record<string, string> = {};
      if (this.apiKey) {
        openaiKwargs.apiKey = this.apiKey;
      } else if (process.env.OPENAI_API_KEY) {
        openaiKwargs.apiKey = process.env.OPENAI_API_KEY;
      } else {
        throw new Error(
          'OPENAI_API_KEY environment variable is required. Please set it with: export OPENAI_API_KEY="your-api-key-here"'
        );
      }
      if (this.baseUrl) {
        openaiKwargs.baseURL = this.baseUrl;
        console.info(`event="client_created" type="openai_compatible" base_url="${this.baseUrl}"`);
      } else {
        console.info(`event="client_created" type="openai"`);
      }

      const openaiClient = new OpenAI(openaiKwargs);
      return { guardrailLlm: openaiClient };
    }
  }

  private _isValidStage(pipelineBundles: PipelineConfig, stage: string): boolean {
    const bundles = pipelineBundles as Record<string, GuardrailBundle | undefined>;
    const stageBundle = bundles[stage];
    return stageBundle !== undefined && stageBundle !== null && stageBundle.guardrails && stageBundle.guardrails.length > 0;
  }

  /**
   * Create a modified copy of a stage bundle with model-specific configuration.
   * 
   * @param stageBundle - Original stage bundle
   * @param model - Model name to inject into guardrail configs
   * @returns Modified stage bundle with updated model configuration
   */
  private _createModelSpecificStageBundle(stageBundle: GuardrailBundle, model: string): GuardrailBundle {
    // Deep copy the bundle using structuredClone for better performance
    // Fall back to JSON parse/stringify for compatibility
    let modifiedBundle: GuardrailBundle;
    try {
      modifiedBundle = structuredClone(stageBundle);
    } catch {
      modifiedBundle = JSON.parse(JSON.stringify(stageBundle));
    }

    for (const guardrail of modifiedBundle.guardrails) {
      if (guardrail.config && typeof guardrail.config === 'object' && 'model' in guardrail.config) {
        guardrail.config.model = model;
      }
    }

    return modifiedBundle;
  }

  private _getValidStages(pipelineBundles: PipelineConfig): string[] {
    if (this.stages === null) {
      // Auto-detect all valid stages
      const availableStages = Array.from(VALID_STAGES).filter((stage) =>
        this._isValidStage(pipelineBundles, stage)
      );

      if (availableStages.length === 0) {
        throw new Error('No valid stages found in configuration');
      }

      console.info(`event="stage_auto_detection" stages="${availableStages.join(', ')}"`);
      return availableStages;
    } else {
      // Validate requested stages
      const validRequestedStages: string[] = [];
      for (const stage of this.stages) {
        if (!VALID_STAGES.has(stage)) {
          console.warn(`Invalid stage '${stage}', skipping`);
          continue;
        }

        if (!this._isValidStage(pipelineBundles, stage)) {
          console.warn(`Stage '${stage}' not found or has no guardrails configured, skipping`);
          continue;
        }

        validRequestedStages.push(stage);
      }

      if (validRequestedStages.length === 0) {
        throw new Error('No valid stages found in configuration');
      }

      return validRequestedStages;
    }
  }

  private async _evaluateSingleStage(
    stage: string,
    pipelineBundles: PipelineConfig,
    samples: Sample[],
    context: Context,
    calculator: GuardrailMetricsCalculator
  ): Promise<{ results: SampleResult[]; metrics: Record<string, unknown> } | null> {
    try {
      const stageBundle = (pipelineBundles as Record<string, GuardrailBundle>)[stage];
      const guardrails = await instantiateGuardrails(stageBundle);

      const engine = new AsyncRunEngine(guardrails, this.multiTurn);

      const stageResults = await engine.run(context, samples, this.batchSize, `Evaluating ${stage} stage`);

      const stageMetrics = calculator.calculate(stageResults);

      return { results: stageResults, metrics: stageMetrics };
    } catch (error) {
      console.error(`Failed to evaluate stage '${stage}': ${error}`);
      return null;
    }
  }

  private _getBenchmarkTarget(pipelineBundles: PipelineConfig): { stageToTest: string; guardrailName: string } {
    let stageToTest: string;
    if (this.stages && this.stages.length > 0) {
      stageToTest = this.stages[0];
      if (!this._isValidStage(pipelineBundles, stageToTest)) {
        throw new Error(`Stage '${stageToTest}' has no guardrails configured`);
      }
    } else {
      // Find first valid stage
      stageToTest = Array.from(VALID_STAGES).find((stage) => this._isValidStage(pipelineBundles, stage)) || '';
      if (!stageToTest) {
        throw new Error('No valid stage found for benchmarking');
      }
    }

    const stageBundle = (pipelineBundles as Record<string, GuardrailBundle>)[stageToTest];
    const guardrailName = stageBundle.guardrails[0]?.name || 'unknown';

    return { stageToTest, guardrailName };
  }

  private async _benchmarkAllModels(
    stageToTest: string,
    guardrailName: string,
    samples: Sample[],
    context: Context,
    benchmarkCalculator: BenchmarkMetricsCalculator,
    basicCalculator: GuardrailMetricsCalculator,
    pipelineBundles: PipelineConfig
  ): Promise<{
    resultsByModel: Record<string, SampleResult[]>;
    metricsByModel: Record<string, Record<string, number>>;
  }> {
    const stageBundle = (pipelineBundles as Record<string, GuardrailBundle>)[stageToTest];

    const resultsByModel: Record<string, SampleResult[]> = {};
    const metricsByModel: Record<string, Record<string, number>> = {};

    // Create semaphore for concurrency control using a proper async queue
    const maxActive = this.maxParallelModels;
    const semaphore: Array<() => void> = [];
    let running = 0;

    const acquire = (): Promise<void> => {
      return new Promise<void>((resolve) => {
        const tryAcquire = () => {
          if (running < maxActive) {
            running += 1;
            resolve();
          } else {
            semaphore.push(tryAcquire);
          }
        };
        tryAcquire();
      });
    };

    const release = (): void => {
      running -= 1;
      if (semaphore.length > 0) {
        const next = semaphore.shift();
        if (next) {
          next();
        }
      }
    };

    const runModelTask = async (index: number, model: string): Promise<void> => {
      await acquire();

      const startTime = performance.now();
      console.info(`event="benchmark_model_start" duration_ms=0 model="${model}" position=${index} total=${this.models.length} active=${running}/${maxActive}`);

      try {
        const modifiedStageBundle = this._createModelSpecificStageBundle(stageBundle, model);

        const modelResults = await this._benchmarkSingleModel(
          model,
          modifiedStageBundle,
          samples,
          context,
          guardrailName,
          benchmarkCalculator,
          basicCalculator
        );

        const elapsedMs = performance.now() - startTime;

        if (modelResults) {
          resultsByModel[model] = modelResults.results;
          metricsByModel[model] = modelResults.metrics;
          console.info(`event="benchmark_model_complete" duration_ms=${elapsedMs.toFixed(2)} model="${model}" status="success"`);
        } else {
          resultsByModel[model] = [];
          metricsByModel[model] = {};
          console.warn(`event="benchmark_model_empty" duration_ms=${elapsedMs.toFixed(2)} model="${model}" status="no_results"`);
        }
      } catch (error) {
        const elapsedMs = performance.now() - startTime;
        resultsByModel[model] = [];
        metricsByModel[model] = {};
        console.error(`event="benchmark_model_failure" duration_ms=${elapsedMs.toFixed(2)} model="${model}" error="${error}"`);
      } finally {
        release();
      }
    };

    // Start all tasks in parallel (they will be throttled by the semaphore)
    const tasks = this.models.map((model, idx) => runModelTask(idx + 1, model));
    await Promise.all(tasks);

    // Log summary
    const successfulModels = this.models.filter((model) => resultsByModel[model] && resultsByModel[model].length > 0);
    const failedModels = this.models.filter((model) => !resultsByModel[model] || resultsByModel[model].length === 0);

    console.info(`event="benchmark_summary" duration_ms=0 successful=${successfulModels.length} failed=${failedModels.length}`);
    console.info(`event="benchmark_successful_models" duration_ms=0 models="${successfulModels.join(', ') || 'None'}"`);
    if (failedModels.length > 0) {
      console.warn(`event="benchmark_failed_models" duration_ms=0 models="${failedModels.join(', ')}"`);
    }
    console.info(`event="benchmark_total_models" duration_ms=0 total=${this.models.length}`);

    return { resultsByModel, metricsByModel };
  }

  private async _benchmarkSingleModel(
    model: string,
    stageBundle: GuardrailBundle,
    samples: Sample[],
    context: Context,
    guardrailName: string,
    benchmarkCalculator: BenchmarkMetricsCalculator,
    basicCalculator: GuardrailMetricsCalculator
  ): Promise<{ results: SampleResult[]; metrics: Record<string, number> } | null> {
    try {
      const guardrails = await instantiateGuardrails(stageBundle);
    const engine = new AsyncRunEngine(guardrails, this.multiTurn);
      const chunkTotal = this.benchmarkChunkSize && samples.length > 0
        ? Math.max(1, Math.ceil(samples.length / this.benchmarkChunkSize))
        : 1;

      const modelResults: SampleResult[] = [];
      let chunkIndex = 1;
      for (const chunk of GuardrailEval._chunkSamples(samples, this.benchmarkChunkSize)) {
        const chunkDesc =
          chunkTotal === 1
            ? `Benchmarking ${model}`
            : `Benchmarking ${model} (${chunkIndex}/${chunkTotal})`;
        const chunkResults = await engine.run(context, chunk, this.batchSize, chunkDesc);
        modelResults.push(...chunkResults);
        chunkIndex += 1;
      }

      const guardrailConfig = stageBundle.guardrails[0]?.config || null;

      const advancedMetrics = benchmarkCalculator.calculateAdvancedMetrics(
        modelResults,
        guardrailName,
        guardrailConfig as Record<string, unknown> | null
      );

      const basicMetrics = basicCalculator.calculate(modelResults);

      let basicMetricsDict: Record<string, number> = {};
      if (guardrailName in basicMetrics) {
        const guardrailMetrics = basicMetrics[guardrailName];
        basicMetricsDict = {
          precision: guardrailMetrics.precision,
          recall: guardrailMetrics.recall,
          f1Score: guardrailMetrics.f1Score,
          truePositives: guardrailMetrics.truePositives,
          falsePositives: guardrailMetrics.falsePositives,
          falseNegatives: guardrailMetrics.falseNegatives,
          trueNegatives: guardrailMetrics.trueNegatives,
          totalSamples: guardrailMetrics.totalSamples,
        };
      }

      const combinedMetrics = { ...basicMetricsDict, ...advancedMetrics };

      return { results: modelResults, metrics: combinedMetrics };
    } catch (error) {
      console.error(`Failed to benchmark model ${model}: ${error}`);
      return null;
    }
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
  stages?: string[] | null;
  batchSize?: number;
  outputDir?: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  azureEndpoint?: string | null;
  azureApiVersion?: string;
  mode?: 'evaluate' | 'benchmark';
  models?: string[] | null;
  latencyIterations?: number;
  multiTurn?: boolean;
  maxParallelModels?: number | null;
  benchmarkChunkSize?: number | null;
}): Promise<void> {
  const evaluator = new GuardrailEval(
    args.configPath,
    args.datasetPath,
    args.stages || null,
    args.batchSize || DEFAULT_BATCH_SIZE,
    args.outputDir || 'results',
    args.apiKey || null,
    args.baseUrl || null,
    args.azureEndpoint || null,
    args.azureApiVersion || '2025-01-01-preview',
    args.mode || 'evaluate',
    args.models || null,
    args.latencyIterations || DEFAULT_LATENCY_ITERATIONS,
    Boolean(args.multiTurn),
    args.maxParallelModels || null,
    args.benchmarkChunkSize || null
  );

  await evaluator.run();
}
