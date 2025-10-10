/**
 * Unit tests for the Guardrails CLI entrypoint.
 *
 * These tests verify argument parsing flows and command routing without
 * exercising the evaluation subcommand (out of scope).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadConfigBundleFromFile = vi.fn();
const instantiateGuardrails = vi.fn();
const validateDatasetCLI = vi.fn();
const runEvaluationCLI = vi.fn();

vi.mock('../../runtime', () => ({
  loadConfigBundleFromFile,
  instantiateGuardrails,
}));

vi.mock('../../evals/core/validate-dataset', () => ({
  validateDatasetCLI,
}));

vi.mock('../../evals/guardrail-evals', () => ({
  runEvaluationCLI,
}));

describe('CLI main', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let main: (argv?: string[]) => void;
  let exitCalls: number[];

  const importMain = async () => {
    vi.resetModules();
    ({ main } = await import('../../cli'));
  };

  beforeEach(async () => {
    loadConfigBundleFromFile.mockReset();
    instantiateGuardrails.mockReset();
    validateDatasetCLI.mockReset();
    runEvaluationCLI.mockReset();

    exitCalls = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await importMain();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const flushMicrotasks = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const runMain = async (argv: string[]) => {
    main(argv);
    await flushMicrotasks();
  };

  it('shows help when --help is provided', async () => {
    await runMain(['node', 'cli', '--help']);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
    expect(logSpy.mock.calls[0]?.[0]).toContain('Guardrails TypeScript CLI');
  });

  it('runs validation command successfully', async () => {
    loadConfigBundleFromFile.mockResolvedValue({ guardrails: [{}, {}] });

    await runMain(['node', 'cli', 'validate', 'config.json']);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);

    expect(loadConfigBundleFromFile).toHaveBeenCalledWith('config.json');
    expect(logSpy.mock.calls.some(([message]) => String(message).includes('Config valid: 2 guardrails loaded'))).toBe(true);
  });

  it('errors when configuration file is missing for validation', async () => {
    await runMain(['node', 'cli', 'validate']);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(2);
    expect(errorSpy.mock.calls.some(([message]) => String(message).includes('Configuration file path is required'))).toBe(true);
  });

  it('runs dataset validation subcommand', async () => {
    validateDatasetCLI.mockResolvedValue(undefined);

    await runMain(['node', 'cli', 'validate-dataset', 'dataset.jsonl']);
    expect(exitSpy).not.toHaveBeenCalled();

    expect(validateDatasetCLI).toHaveBeenCalledWith('dataset.jsonl');
  });
});
