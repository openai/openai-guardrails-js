/**
 * Dataset validation utility for guardrail evaluation.
 *
 * This module provides functions for validating evaluation datasets in JSONL format.
 * It checks that each sample conforms to the expected schema and reports errors for invalid entries.
 */

import type { RawSample, Sample } from './types';

/**
 * Normalize a raw sample to the standard Sample format.
 * Handles both snake_case and camelCase field naming conventions.
 */
function normalizeSample(rawSample: RawSample): Sample {
  // Handle both field naming conventions
  const expectedTriggers = rawSample.expectedTriggers || rawSample.expected_triggers;

  if (!expectedTriggers) {
    throw new Error('Missing expectedTriggers or expected_triggers field');
  }

  return {
    id: rawSample.id,
    data: rawSample.data,
    expectedTriggers,
  };
}

/**
 * Validate the entire dataset file.
 *
 * Returns a tuple of [isValid, errorMessages].
 *
 * @param datasetPath - Path to the dataset JSONL file
 * @returns Tuple containing:
 *   - Boolean indicating if validation was successful
 *   - List of error messages
 *
 * @throws {Error} If the dataset file does not exist
 * @throws {Error} If there are any file I/O errors
 */
export async function validateDataset(datasetPath: string): Promise<[boolean, string[]]> {
  const fs = await import('node:fs/promises');

  try {
    await fs.stat(datasetPath);
  } catch {
    throw new Error(`Dataset file not found: ${datasetPath}`);
  }

  let hasErrors = false;
  const errorMessages: string[] = [];

  try {
    const content = await fs.readFile(datasetPath, 'utf-8');
    const lines = content.split('\n');

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1].trim();
      if (!line) continue;

      try {
        const rawSample = JSON.parse(line) as RawSample;

        // Validate required fields
        if (!rawSample.id || typeof rawSample.id !== 'string') {
          hasErrors = true;
          errorMessages.push(`Line ${lineNum}: Invalid Sample format`);
          errorMessages.push(`  - Missing or invalid id field`);
        }
        if (!rawSample.data || typeof rawSample.data !== 'string') {
          hasErrors = true;
          errorMessages.push(`Line ${lineNum}: Invalid Sample format`);
          errorMessages.push(`  - Missing or invalid data field`);
        }

        // Check for either expectedTriggers or expected_triggers
        const hasExpectedTriggers =
          rawSample.expectedTriggers && typeof rawSample.expectedTriggers === 'object';
        const hasExpectedTriggersSnake =
          rawSample.expected_triggers && typeof rawSample.expected_triggers === 'object';

        if (!hasExpectedTriggers && !hasExpectedTriggersSnake) {
          hasErrors = true;
          errorMessages.push(`Line ${lineNum}: Invalid Sample format`);
          errorMessages.push(`  - Missing or invalid expectedTriggers/expected_triggers field`);
        }

        // Try to normalize the sample to catch any other validation issues
        if (!hasErrors) {
          try {
            normalizeSample(rawSample);
          } catch (error) {
            hasErrors = true;
            errorMessages.push(`Line ${lineNum}: Invalid Sample format`);
            errorMessages.push(`  - ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch (error) {
        hasErrors = true;
        errorMessages.push(`Line ${lineNum}: Invalid JSON`);
        errorMessages.push(`  - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to read dataset file: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!hasErrors) {
    errorMessages.push('Validation successful!');
    return [true, errorMessages];
  } else {
    errorMessages.unshift('Dataset validation failed!');
    return [false, errorMessages];
  }
}

/**
 * CLI entry point for dataset validation.
 *
 * @param datasetPath - Path to the evaluation dataset JSONL file
 */
export async function validateDatasetCLI(datasetPath: string): Promise<void> {
  try {
    const [success, messages] = await validateDataset(datasetPath);
    for (const message of messages) {
      console.log(message);
    }
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
