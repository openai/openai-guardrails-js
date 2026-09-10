import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// Load the compiler's CommonJS API without Vite's default-export interop.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

it('accepts migrated public schemas and client types in a consumer', () => {
  const program = ts.createProgram(
    [fileURLToPath(new URL('./fixtures/sdk-types.ts', import.meta.url))],
    {
      noEmit: true,
      strict: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
      esModuleInterop: true,
    }
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  ).toEqual([]);
}, 15_000);
