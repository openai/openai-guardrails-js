# Contributing

Thanks for contributing to OpenAI Guardrails for TypeScript! Bug reports, documentation
improvements, and focused code changes are welcome.

## Reporting bugs and proposing changes

Search the [existing issues](https://github.com/openai/openai-guardrails-js/issues) before
opening a new one. For bugs, include a minimal reproduction, the package and Node.js
versions, and the expected and actual behavior. Remove API keys and sensitive data
from examples and logs.

For substantial changes or public API proposals, open an issue to discuss the approach
before implementing it.

## Development setup

Use Node.js 22 to match CI, along with npm. Fork the repository if you do not have write
access, then clone your fork and create a branch for your change.

From the repository root, install the locked dependencies and build:

```bash
npm ci
npm run build
```

Run `npm run dev` to rebuild TypeScript as you edit.

## Repository layout

- `src/`: TypeScript implementation, including clients and the guardrail runtime.
- `src/checks/`: Built-in guardrail checks.
- `src/evals/`: Evaluation framework.
- `src/__tests__/unit/` and `src/__tests__/integration/`: Vitest tests.
- `examples/`: Usage examples and sample configurations.
- `docs/`: MkDocs documentation.
- `dist/`: Generated build output; do not commit it.

## Making and checking changes

Keep changes focused on the issue being addressed and follow the surrounding code's
conventions. Add or update tests for behavior changes and update documentation or
examples when usage changes. Prefer mocked external services in tests so they remain
deterministic.

Before submitting a pull request, run the same checks as CI:

```bash
npm run build
npm run test:run
npm run lint
```

For faster feedback while developing:

```bash
# Run tests in watch mode
npm run test:watch

# Run one test file once
npm run test:run -- src/__tests__/unit/runtime.test.ts
```

The project uses ESLint and Prettier. To format a changed TypeScript file, run
`npx prettier --write path/to/file.ts`. The `npm run format` command formats JavaScript,
TypeScript, and JSON files throughout the repository; review the diff and avoid
unrelated formatting changes.

See [examples/README.md](examples/README.md) for example-specific setup. Examples that
call external APIs may require credentials and incur usage charges. Keep credentials
out of source control.

## Documentation

To work on the documentation site, install Python 3.11 or newer and `uv`, then run:

```bash
make sync
make serve-docs
```

Validate documentation changes with `make build-docs`. Generated site output belongs
in `site/` and should not be committed.

## Pull requests

- Target the `main` branch and keep each pull request focused on one change.
- Explain the problem, the resulting behavior, and how you tested the change.
- Link any relevant issues and call out compatibility implications.
- Include relevant tests and documentation, without generated build output or secrets.
- Check CI results and address failures and review feedback before merging.
