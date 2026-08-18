#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { console, process } = globalThis;
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
function printUsage() {
  console.log(`code-change-verification

Usage:
  node .agents/skills/code-change-verification/scripts/run.mjs
`);
}

function getRepoRoot() {
  return path.resolve(scriptDir, '../../../..');
}

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function getChildEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))
  );
}

function runNpm(repoRoot, label, args) {
  console.log(`Running npm ${args.join(' ')}...`);
  const result = spawnSync(getNpmCommand(), args, {
    cwd: repoRoot,
    env: getChildEnvironment(),
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`code-change-verification: ${label} failed to start.`);
    console.error(result.error);
    return 1;
  }
  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      console.error(`code-change-verification: ${label} failed with exit code ${result.status}.`);
    }
    return result.status;
  }

  console.error(
    `code-change-verification: ${label} terminated by ${result.signal ?? 'an unknown signal'}.`
  );
  return 1;
}

function runVerification() {
  const repoRoot = getRepoRoot();
  const installExitCode = runNpm(repoRoot, 'install', ['ci']);
  if (installExitCode !== 0) {
    return installExitCode;
  }

  const buildExitCode = runNpm(repoRoot, 'build', ['run', 'build']);
  if (buildExitCode !== 0) {
    return buildExitCode;
  }

  const validationSteps = [
    ['lint', ['run', 'lint']],
    ['test', ['run', 'test:run']],
    ['format-check', ['exec', '--', 'prettier', '--check', '**/*.{cjs,cts,js,json,mjs,mts,ts}']],
  ];

  for (const [label, args] of validationSteps) {
    const exitCode = runNpm(repoRoot, label, args);
    if (exitCode !== 0) {
      return exitCode;
    }
  }

  console.log('code-change-verification: all commands passed.');
  return 0;
}

const commandLineArguments = process.argv.slice(2);
if (commandLineArguments.length === 1 && commandLineArguments[0] === '--help') {
  printUsage();
  process.exit(0);
}
if (commandLineArguments.length !== 0) {
  console.error('code-change-verification does not accept arguments.');
  process.exit(2);
}

process.exit(runVerification());
