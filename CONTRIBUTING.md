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

Use Node.js 22.13 or newer within Node 22, or Node.js 24 or newer, along with npm.
CI tests Node.js 22, 24, and 26. Node.js 23 is not supported.

Fork the repository if you do not have write access, then clone your fork and create
a branch for your change.

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
- `docs/`: VitePress documentation; branding and navigation live in `docs/.vitepress/`.
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

The project uses [Biome](https://biomejs.dev/) for JavaScript, TypeScript, and JSON.
Run `npm run lint` to check lint rules, formatting, and import organization across
source, tests, examples, and tooling. CI rejects errors and warnings. Use
`npm run lint:fix` for safe automatic fixes, `npm run format` to format all included
files, or `npx biome check --write path/to/file.ts` for a single file.
`npm run format:check` checks formatting without writing files.

The configuration enables Biome's recommended rules and explicitly rejects unused
imports, variables and parameters, explicit `any`, and non-null assertions. It also
requires `node:` imports and type-only imports. TypeScript's strict compiler checks
remain enabled; Biome does not replace `npm run build`.

Narrow exceptions preserve existing static class APIs and constructors with
compatibility parameters, plus the regex `exec` assignment loops in the keyword and
PII checks. Resource adapters retain documented, local exceptions for accessing
protected SDK members without changing the public client API. Do not broaden these
exceptions to bypass new violations.

Generated output, dependencies, and the npm lockfile are excluded. Markdown and CSS
are outside this formatter's scope, matching the previous formatting command.

See [examples/README.md](examples/README.md) for example-specific setup. Examples that
call external APIs may require credentials and incur usage charges. Keep credentials
out of source control.

## Documentation

Documentation uses the same Node.js and npm setup as the SDK. Run:

```bash
npm ci
npm run docs:dev
```

Validate changes with `npm run docs:check`, then inspect the built site with
`npm run docs:preview`. Generated output in `site/` should not be committed.
The Makefile's `sync`, `serve-docs`, and `build-docs` targets wrap these npm commands.

Pages retain their existing directory URLs, such as `/quickstart/`. Use site-root
links in Markdown (`/quickstart/` or `/assets/images/example.png`); VitePress adds
the GitHub Pages base path. Static images and branding files live in `docs/public/`.

The docs check builds the site and verifies published URLs, heading anchors, and local links.
Pull request CI runs this check. Pushes to `main` deploy `site/` to GitHub Pages
using the Deploy docs workflow. To redeploy the current `main` manually, use the
workflow's Run workflow button or `make deploy-docs` (requires the GitHub CLI).

## Pull requests

- Target the `main` branch and keep each pull request focused on one change.
- Explain the problem, the resulting behavior, and how you tested the change.
- Link any relevant issues and call out compatibility implications.
- Include relevant tests and documentation, without generated build output or secrets.
- Check CI results and address failures and review feedback before merging.
