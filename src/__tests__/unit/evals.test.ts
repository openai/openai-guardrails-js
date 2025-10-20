/**
 * Unit tests for the evaluation framework.
 *
 * This module tests the evaluation framework components including:
 * - GuardrailMetricsCalculator
 * - Dataset validation
 * - Results reporting
 * - Core evaluation functionality
 */

import { describe, it, expect, vi } from 'vitest';
import { GuardrailMetricsCalculator, validateDataset, JsonResultsReporter } from '../../evals';
import { SampleResult, GuardrailMetrics } from '../../evals/core/types';
import { Stats } from 'fs';

// Using type assertion for fs.Stats mock due to complex union type requirements

// Mock file system operations
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn(),
  dirname: vi.fn(),
}));

describe('Evaluation Framework', () => {
  describe('GuardrailMetricsCalculator', () => {
    it('should calculate metrics correctly', () => {
      const calculator = new GuardrailMetricsCalculator();

      const results: SampleResult[] = [
        {
          id: '1',
          expectedTriggers: { test: true },
          triggered: { test: true },
          details: {},
        },
        {
          id: '2',
          expectedTriggers: { test: false },
          triggered: { test: false },
          details: {},
        },
        {
          id: '3',
          expectedTriggers: { test: false },
          triggered: { test: true },
          details: {},
        },
        {
          id: '4',
          expectedTriggers: { test: true },
          triggered: { test: false },
          details: {},
        },
      ];

      const metrics = calculator.calculate(results);
      expect(metrics).toHaveProperty('test');

      const testMetrics = metrics['test'];
      expect(testMetrics.truePositives).toBe(1);
      expect(testMetrics.falsePositives).toBe(1);
      expect(testMetrics.falseNegatives).toBe(1);
      expect(testMetrics.trueNegatives).toBe(1);
      expect(testMetrics.precision).toBe(0.5);
      expect(testMetrics.recall).toBe(0.5);
      expect(testMetrics.f1Score).toBe(0.5);
    });

    it('should handle empty results', () => {
      const calculator = new GuardrailMetricsCalculator();
      expect(() => calculator.calculate([])).toThrow(
        'Cannot calculate metrics for empty results list'
      );
    });

    it('should handle single result', () => {
      const calculator = new GuardrailMetricsCalculator();

      const results: SampleResult[] = [
        {
          id: '1',
          expectedTriggers: { test: true },
          triggered: { test: true },
          details: {},
        },
      ];

      const metrics = calculator.calculate(results);
      const testMetrics = metrics['test'];
      expect(testMetrics.truePositives).toBe(1);
      expect(testMetrics.falsePositives).toBe(0);
      expect(testMetrics.falseNegatives).toBe(0);
      expect(testMetrics.trueNegatives).toBe(0);
    });
  });

  describe('validateDataset', () => {
    it('should validate valid dataset', async () => {
      const mockFs = await import('fs/promises');
      vi.mocked(mockFs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024
      } as unknown as Stats);
      vi.mocked(mockFs.readFile).mockResolvedValue(
        '{"id":"1","data":"Sample 1","expectedTriggers":{"test":true}}\n{"id":"2","data":"Sample 2","expectedTriggers":{"test":false}}'
      );

      const [isValid, errors] = await validateDataset('/tmp/test.jsonl');
      expect(isValid).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Validation successful!');
    });

    it('should validate dataset with snake_case field names', async () => {
      const mockFs = await import('fs/promises');
      vi.mocked(mockFs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024
      } as unknown as Stats);
      vi.mocked(mockFs.readFile).mockResolvedValue(
        '{"id":"1","data":"Sample 1","expected_triggers":{"test":true}}\n{"id":"2","data":"Sample 2","expected_triggers":{"test":false}}'
      );

      const [isValid, errors] = await validateDataset('/tmp/test.jsonl');
      expect(isValid).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Validation successful!');
    });

    it('should validate dataset with mixed field naming conventions', async () => {
      const mockFs = await import('fs/promises');
      vi.mocked(mockFs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024
      } as unknown as Stats);
      vi.mocked(mockFs.readFile).mockResolvedValue(
        '{"id":"1","data":"Sample 1","expectedTriggers":{"test":true}}\n{"id":"2","data":"Sample 2","expected_triggers":{"test":false}}'
      );

      const [isValid, errors] = await validateDataset('/tmp/test.jsonl');
      expect(isValid).toBe(true);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Validation successful!');
    });

    it('should detect invalid dataset structure', async () => {
      const mockFs = await import('fs/promises');
      vi.mocked(mockFs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024
      } as unknown as Stats);
      vi.mocked(mockFs.readFile).mockResolvedValue(
        '{"id":"1","data":"Sample 1"}\n{"id":"2","expectedTriggers":{"test":false}}'
      );

      const [isValid, errors] = await validateDataset('/tmp/test.jsonl');
      expect(isValid).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should handle malformed JSON', async () => {
      const mockFs = await import('fs/promises');
      vi.mocked(mockFs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
        size: 1024
      } as unknown as Stats);
      vi.mocked(mockFs.readFile).mockResolvedValue(
        'invalid json\n{"id":"1","data":"Sample 1","expectedTriggers":{"test":true}}'
      );

      const [isValid, errors] = await validateDataset('/tmp/test.jsonl');
      expect(isValid).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('JsonResultsReporter', () => {
    it('should save results to files', async () => {
      const mockFs = await import('fs/promises');
      const mockPath = await import('path');
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
      vi.mocked(mockPath.join).mockReturnValue('/tmp/results.jsonl');

      const reporter = new JsonResultsReporter();
      const results: SampleResult[] = [
        {
          id: '1',
          expectedTriggers: { test: true },
          triggered: { test: true },
          details: {},
        },
      ];
      const metrics: Record<string, GuardrailMetrics> = {
        test: {
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          trueNegatives: 0,
          totalSamples: 1,
          precision: 1.0,
          recall: 1.0,
          f1Score: 1.0,
        },
      };

      await expect(reporter.save(results, metrics, 'test-output')).resolves.not.toThrow();
    });

    it('should create output directory if it does not exist', async () => {
      const mockFs = await import('fs/promises');
      const mockPath = await import('path');
      vi.mocked(mockFs.mkdir).mockResolvedValue(undefined);
      vi.mocked(mockFs.writeFile).mockResolvedValue(undefined);
      vi.mocked(mockPath.join).mockReturnValue('/tmp/results.jsonl');

      const reporter = new JsonResultsReporter();
      const results: SampleResult[] = [
        {
          id: '1',
          expectedTriggers: { test: true },
          triggered: { test: true },
          details: {},
        },
      ];
      const metrics: Record<string, GuardrailMetrics> = {
        test: {
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          trueNegatives: 0,
          totalSamples: 1,
          precision: 1.0,
          recall: 1.0,
          f1Score: 1.0,
        },
      };

      await expect(reporter.save(results, metrics, 'new-output-dir')).resolves.not.toThrow();
    });

    it('should reject empty results', async () => {
      const reporter = new JsonResultsReporter();
      const results: SampleResult[] = [];
      const metrics: Record<string, GuardrailMetrics> = {};

      await expect(reporter.save(results, metrics, 'test-output')).rejects.toThrow(
        'Cannot save empty results list'
      );
    });
  });
});
