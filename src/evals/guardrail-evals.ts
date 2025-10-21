/**
 * Guardrail evaluation runner.
 *
 * This class provides the main interface for running guardrail evaluations on datasets.
 * It loads guardrail configurations, runs evaluations asynchronously, calculates metrics, and saves results.
 */

import { Context } from './core/types';
import { JsonlDatasetLoader } from './core/jsonl-loader';
import { AsyncRunEngine } from './core/async-engine';
import { GuardrailMetricsCalculator } from './core/calculator';
import { JsonResultsReporter } from './core/json-reporter';
import { loadConfigBundleFromFile, instantiateGuardrails } from '../runtime';
import { OpenAI } from 'openai';

/**
 * Class for running guardrail evaluations.
 */
export class GuardrailEval {
  private configPath: string;
  private datasetPath: string;
  private batchSize: number;
  private outputDir: string;

  /**
   * Initialize the evaluator.
   *
   * @param configPath - Path to the guardrail config file
   * @param datasetPath - Path to the evaluation dataset
   * @param batchSize - Number of samples to process in parallel
   * @param outputDir - Directory to save evaluation results
   */
  constructor(
    configPath: string,
    datasetPath: string,
    batchSize: number = 32,
    outputDir: string = 'results'
  ) {
    this.configPath = configPath;
    this.datasetPath = datasetPath;
    this.batchSize = batchSize;
    this.outputDir = outputDir;
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
    const engine = new AsyncRunEngine(guardrails);
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
}): Promise<void> {
  const evaluator = new GuardrailEval(
    args.configPath,
    args.datasetPath,
    args.batchSize || 32,
    args.outputDir || 'results'
  );

  await evaluator.run();
}
