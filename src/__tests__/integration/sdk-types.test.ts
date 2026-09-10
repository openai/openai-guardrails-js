import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const require = createRequire(import.meta.url);

it('accepts migrated public schemas and client types in a consumer', () => {
  // Use the same compiler CLI as the package build, outside the test runner.
  execFileSync(
    process.execPath,
    [
      resolve(
        dirname(require.resolve('typescript/package.json')),
        require('typescript/package.json').bin.tsc
      ),
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--skipLibCheck',
      '--target',
      'ES2020',
      '--module',
      'Node16',
      '--moduleResolution',
      'Node16',
      '--esModuleInterop',
      fileURLToPath(new URL('./fixtures/sdk-types.ts', import.meta.url)),
    ],
    { encoding: 'utf8' }
  );
}, 15_000);
