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
    '  --batch-size <number>                         Number of samples to process in parallel (default: 32)'
  );
  console.log(
    '  --output-dir <dir>                            Directory to save results (default: results/)'
  );
  console.log('');
  console.log('Examples:');
  console.log('  guardrails validate config.json');
  console.log('  guardrails validate config.json --media-type text/plain');
  console.log('  guardrails eval --config-path config.json --dataset-path dataset.jsonl');
  console.log(
    '  guardrails eval --config-path config.json --dataset-path dataset.jsonl --batch-size 16 --output-dir my-results'
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

  try {
    await runEvaluationCLI({
      configPath: args.configPath,
      datasetPath: args.datasetPath,
      batchSize: args.batchSize || 32,
      outputDir: args.outputDir || 'results',
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
