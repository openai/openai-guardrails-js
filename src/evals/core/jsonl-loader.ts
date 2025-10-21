/**
 * JSONL dataset loader for guardrail evaluation.
 *
 * This module provides a loader for reading and validating evaluation datasets in JSONL format.
 * It ensures that all samples conform to the expected schema before use in evaluation.
 */

import { DatasetLoader, Sample, RawSample } from './types';
import { validateDataset } from './validate-dataset';

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
 * Loads and validates datasets from JSONL files.
 */
export class JsonlDatasetLoader implements DatasetLoader {
  /**
   * Load and validate dataset from a JSONL file.
   *
   * @param path - Path to the JSONL file
   * @returns List of validated samples
   *
   * @throws {Error} If the dataset file does not exist
   * @throws {Error} If the dataset validation fails
   * @throws {Error} If any line in the file is not valid JSON
   */
  async load(path: string): Promise<Sample[]> {
    const fs = await import('fs/promises');

    if (!(await fs.stat(path).catch(() => false))) {
      throw new Error(`Dataset file not found: ${path}`);
    }

    // Validate dataset first
    try {
      const [isValid, errorMessages] = await validateDataset(path);
      if (!isValid) {
        throw new Error(`Dataset validation failed: ${errorMessages.join(', ')}`);
      }
    } catch (error) {
      throw new Error(
        `Dataset validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const samples: Sample[] = [];
    try {
      const content = await fs.readFile(path, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
          continue;
        }

        try {
          const rawSample = JSON.parse(line) as RawSample;

          // Validate required fields
          if (!rawSample.id || typeof rawSample.id !== 'string') {
            throw new Error('Missing or invalid id field');
          }
          if (!rawSample.data || typeof rawSample.data !== 'string') {
            throw new Error('Missing or invalid data field');
          }

          // Check for either expectedTriggers or expected_triggers
          const hasExpectedTriggers =
            rawSample.expectedTriggers && typeof rawSample.expectedTriggers === 'object';
          const hasExpectedTriggersSnake =
            rawSample.expected_triggers && typeof rawSample.expected_triggers === 'object';

          if (!hasExpectedTriggers && !hasExpectedTriggersSnake) {
            throw new Error('Missing or invalid expectedTriggers/expected_triggers field');
          }

          // Normalize the sample to standard format
          const normalizedSample = normalizeSample(rawSample);
          samples.push(normalizedSample);
        } catch (error) {
          throw new Error(
            `Invalid JSON in dataset at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      console.info(`Loaded ${samples.length} samples from ${path}`);
      return samples;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid JSON')) {
        throw error;
      }
      throw new Error(
        `Error reading dataset file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
