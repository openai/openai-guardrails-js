#!/usr/bin/env node

/**
 * Unified CLI for Guardrails TypeScript.
 *
 * This CLI provides a single entry point for all guardrails operations:
 * - Validating guardrail configurations
 * - Running evaluations
 * - Dataset validation
 * - General guardrails operations
 *
 * Usage:
 *   guardrails validate <config-file> [--media-type <type>]
 *   guardrails eval --config-path <CONFIG_PATH> --dataset-path <DATASET_PATH> [options]
 *   guardrails validate-dataset <dataset-path>
 *   guardrails --help
 */

// Import checks to ensure they get registered with the defaultSpecRegistry
import './checks';

import { runEvaluationCLI } from './evals/guardrail-evals';
import { validateDatasetCLI } from './evals/core/validate-dataset';
import { loadConfigBundleFromFile } from './runtime';

/**
 * Command line arguments interface.
 */
interface CliArgs {
  command: string;
  subcommand?: string;
  configFile?: string;
  mediaType?: string;
  configPath?: string;
  datasetPath?: string;
  batchSize?: number;
  outputDir?: string;
  multiTurn?: boolean;
  maxParallelModels?: number | null;
  benchmarkChunkSize?: number | null;
  mode?: 'evaluate' | 'benchmark';
  stages?: string[];
  models?: string[];
  latencyIterations?: number;
  apiKey?: string | null;
  baseUrl?: string | null;
  azureEndpoint?: string | null;
  azureApiVersion?: string;
  help?: boolean;
}

/**
 * Parse command line arguments.
 *
 * @param argv - Command line arguments.
 * @returns Parsed arguments.
 */
function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: '' };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === 'validate') {
      args.command = 'validate';
    } else if (arg === 'validate-dataset') {
      args.command = 'validate';
      args.subcommand = 'dataset';
    } else if (arg === 'eval') {
      args.command = 'eval';
    } else if (arg === '-m' || arg === '--media-type') {
      args.mediaType = argv[++i];
    } else if (arg === '--config-path') {
      args.configPath = argv[++i];
    } else if (arg === '--dataset-path') {
      args.datasetPath = argv[++i];
    } else if (arg === '--batch-size') {
      args.batchSize = parseInt(argv[++i], 10);
    } else if (arg === '--output-dir') {
      args.outputDir = argv[++i];
    } else if (arg === '--multi-turn') {
      args.multiTurn = true;
    } else if (arg === '--max-parallel-models') {
      const value = parseInt(argv[++i], 10);
      if (isNaN(value) || value <= 0) {
        console.error(`❌ Error: max-parallel-models must be positive, got: ${argv[i]}`);
        process.exit(1);
      }
      args.maxParallelModels = value;
    } else if (arg === '--benchmark-chunk-size') {
      const value = parseInt(argv[++i], 10);
      if (isNaN(value) || value <= 0) {
        console.error(`❌ Error: benchmark-chunk-size must be positive, got: ${argv[i]}`);
        process.exit(1);
      }
      args.benchmarkChunkSize = value;
    } else if (arg === '--mode') {
      const mode = argv[++i];
      if (mode !== 'evaluate' && mode !== 'benchmark') {
        console.error(`❌ Error: Invalid mode: ${mode}. Must be 'evaluate' or 'benchmark'`);
        process.exit(1);
      }
      args.mode = mode as 'evaluate' | 'benchmark';
    } else if (arg === '--stages') {
      args.stages = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.stages.push(argv[++i]);
      }
    } else if (arg === '--models') {
      args.models = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.models.push(argv[++i]);
      }
    } else if (arg === '--latency-iterations') {
      const value = parseInt(argv[++i], 10);
      if (isNaN(value) || value <= 0) {
        console.error(`❌ Error: latency-iterations must be positive, got: ${argv[i]}`);
        process.exit(1);
      }
      args.latencyIterations = value;
    } else if (arg === '--api-key') {
      args.apiKey = argv[++i];
    } else if (arg === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (arg === '--azure-endpoint') {
      args.azureEndpoint = argv[++i];
    } else if (arg === '--azure-api-version') {
      args.azureApiVersion = argv[++i];
    } else if (!args.configFile && !arg.startsWith('-')) {
      args.configFile = arg;
    }
  }

  return args;
}

/**
 * Load and validate a guardrail configuration bundle.
 *
 * @param configPath - Path to the configuration file.
 * @returns Number of guardrails in the bundle.
 */
async function loadConfigBundle(configPath: string): Promise<number> {
  try {
    const bundle = await loadConfigBundleFromFile(configPath);
    return bundle.guardrails.length;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load configuration: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Display help information.
 */
function showHelp(): void {
  console.log('Guardrails TypeScript CLI');
  console.log('');
  console.log('Usage: guardrails <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  validate <config-file> [--media-type <type>]  Validate guardrails configuration');
  console.log('  eval [options]                                Run guardrail evaluations');
  console.log('  validate-dataset <dataset-path>               Validate evaluation dataset');
  console.log('  --help, -h                                    Show this help message');
  console.log('');
  console.log('Evaluation Options:');
  console.log(
    '  --config-path <path>                          Path to guardrail config file (required)'
  );
  console.log(
    '  --dataset-path <path>                         Path to evaluation dataset (required)'
  );
  console.log(
    '  --mode <mode>                                 Evaluation mode: "evaluate" or "benchmark" (default: evaluate)'
  );
  console.log(
    '  --stages <stage>...                            Pipeline stages to evaluate: pre_flight, input, output'
  );
  console.log(
    '  --batch-size <number>                         Number of samples to process in parallel (default: 32)'
  );
  console.log(
    '  --output-dir <dir>                            Directory to save results (default: results/)'
  );
  console.log(
    '  --multi-turn                                  Evaluate conversation-aware guardrails turn-by-turn (default: single-pass)'
  );
  console.log('Benchmark Options:');
  console.log(
    '  --models <model>...                            Models to test in benchmark mode (default: gpt-5, gpt-5-mini, gpt-4.1, gpt-4.1-mini)'
  );
  console.log(
    '  --latency-iterations <number>                 Number of iterations for latency testing (default: 25)'
  );
  console.log(
    '  --max-parallel-models <number>                Maximum number of models to benchmark concurrently (default: min(models, cpu_count))'
  );
  console.log(
    '  --benchmark-chunk-size <number>                Optional number of samples per chunk when benchmarking to limit long-running runs'
  );
  console.log('API Configuration:');
  console.log(
    '  --api-key <key>                               API key for OpenAI, Azure OpenAI, or OpenAI-compatible API'
  );
  console.log(
    '  --base-url <url>                              Base URL for OpenAI-compatible API (e.g., http://localhost:11434/v1)'
  );
  console.log(
    '  --azure-endpoint <endpoint>                   Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)'
  );
  console.log(
    '  --azure-api-version <version>                 Azure OpenAI API version (default: 2025-01-01-preview)'
  );
  console.log('');
  console.log('Examples:');
  console.log('  guardrails validate config.json');
  console.log('  guardrails validate config.json --media-type text/plain');
  console.log('  guardrails eval --config-path config.json --dataset-path dataset.jsonl');
  console.log(
    '  guardrails eval --config-path config.json --dataset-path dataset.jsonl --batch-size 16 --output-dir my-results'
  );
  console.log(
    '  guardrails eval --config-path config.json --dataset-path dataset.jsonl --mode benchmark --models gpt-5 gpt-5-mini'
  );
  console.log(
    '  guardrails eval --config-path config.json --dataset-path dataset.jsonl --mode benchmark --azure-endpoint https://your-resource.openai.azure.com --api-key your-key'
  );
  console.log('  guardrails validate-dataset dataset.jsonl');
}

/**
 * Handle evaluation command.
 *
 * @param args - Parsed command line arguments.
 */
async function handleEvalCommand(args: CliArgs): Promise<void> {
  if (!args.configPath || !args.datasetPath) {
    console.error('Error: --config-path and --dataset-path are required for evaluation');
    console.error('');
    console.error(
      'Usage: guardrails eval --config-path <CONFIG_PATH> --dataset-path <DATASET_PATH> [--batch-size N] [--output-dir DIR]'
    );
    process.exit(1);
  }

  if (args.maxParallelModels !== undefined && args.maxParallelModels !== null && args.maxParallelModels <= 0) {
    console.error(`❌ Error: max-parallel-models must be positive, got: ${args.maxParallelModels}`);
    process.exit(1);
  }

  if (args.benchmarkChunkSize !== undefined && args.benchmarkChunkSize !== null && args.benchmarkChunkSize <= 0) {
    console.error(`❌ Error: benchmark-chunk-size must be positive, got: ${args.benchmarkChunkSize}`);
    process.exit(1);
  }

  if (args.latencyIterations !== undefined && args.latencyIterations <= 0) {
    console.error(`❌ Error: latency-iterations must be positive, got: ${args.latencyIterations}`);
    process.exit(1);
  }

  if (args.stages) {
    const validStages = new Set(['pre_flight', 'input', 'output']);
    const invalidStages = args.stages.filter((s) => !validStages.has(s));
    if (invalidStages.length > 0) {
      console.error(`❌ Error: Invalid stages: ${invalidStages.join(', ')}. Valid stages are: ${Array.from(validStages).join(', ')}`);
      process.exit(1);
    }
  }

  if (args.mode === 'benchmark' && args.stages && args.stages.length > 1) {
    console.warn('⚠️  Warning: Benchmark mode only uses the first specified stage. Additional stages will be ignored.');
  }

  if (args.azureEndpoint && args.baseUrl) {
    console.error('❌ Error: Cannot specify both --azure-endpoint and --base-url. Choose one provider.');
    process.exit(1);
  }

  if (args.azureEndpoint && !args.apiKey) {
    console.error('❌ Error: --api-key is required when using --azure-endpoint');
    process.exit(1);
  }

  try {
    await runEvaluationCLI({
      configPath: args.configPath,
      datasetPath: args.datasetPath,
      stages: args.stages || null,
      batchSize: args.batchSize || 32,
      outputDir: args.outputDir || 'results',
      apiKey: args.apiKey || null,
      baseUrl: args.baseUrl || null,
      azureEndpoint: args.azureEndpoint || null,
      azureApiVersion: args.azureApiVersion || '2025-01-01-preview',
      mode: args.mode || 'evaluate',
      models: args.models || null,
      latencyIterations: args.latencyIterations,
      multiTurn: args.multiTurn,
      maxParallelModels: args.maxParallelModels,
      benchmarkChunkSize: args.benchmarkChunkSize,
    });

    console.log('Evaluation completed successfully!');
  } catch (error) {
    console.error('Evaluation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Handle validation command.
 *
 * @param args - Parsed command line arguments.
 */
async function handleValidateCommand(args: CliArgs): Promise<void> {
  if (args.subcommand === 'dataset') {
    // Handle dataset validation
    if (!args.configFile) {
      console.error('ERROR: Dataset path is required for dataset validation');
      process.exit(2);
    }

    try {
      await validateDatasetCLI(args.configFile);
    } catch (error) {
      console.error('Dataset validation failed:', error);
      process.exit(1);
    }
    return;
  }

  // Handle config validation
  if (!args.configFile) {
    console.error('ERROR: Configuration file path is required');
    process.exit(2);
  }

  try {
    const total = await loadConfigBundle(args.configFile);
    console.log(`Config valid: ${total} guardrails loaded`);
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Main entry point for the Guardrails CLI.
 *
 * Parses command-line arguments and routes to appropriate handlers.
 *
 * @param argv - Optional list of arguments for testing or programmatic use.
 */
export function main(argv: string[] = process.argv): void {
  try {
    const args = parseArgs(argv);

    if (args.help || args.command === '') {
      showHelp();
      process.exit(0);
    }

    if (args.command === 'validate') {
      handleValidateCommand(args).catch((error) => {
        console.error('Unexpected error during validation:', error);
        process.exit(1);
      });
    } else if (args.command === 'eval') {
      handleEvalCommand(args).catch((error) => {
        console.error('Unexpected error during evaluation:', error);
        process.exit(1);
      });
    } else {
      console.error(`Unknown command: ${args.command}`);
      console.error('Use --help for usage information');
      process.exit(2);
    }
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// Run CLI if this file is executed directly
if (require.main === module) {
  main();
}
