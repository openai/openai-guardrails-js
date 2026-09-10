# Releasing @openai/guardrails

Changesets manages release notes, version pull requests, npm publishing, tags,
and GitHub Releases. Follow the [Changesets release guide](.changeset/README.md)
for contributor instructions, first-release notes, and recovery procedures.

## Release process

1. Include a changeset with each user-visible feature or fix. Internal-only
   tooling, CI, tests, docs, and refactors do not need release notes.
2. Merging changesets to `main` opens or updates `changeset-release/main` using
   the repository's `GITHUB_TOKEN`. Review the version and changelog, approve
   workflow runs when GitHub requests it, and wait for required checks to pass.
3. Merge the version PR through the normal review and merge-queue process.
   `publish.yml` builds, tests, and lints, publishes to npm through trusted
   publishing (OIDC), and creates the `v<version>` tag and GitHub Release.

No manual tag push, release-please configuration, or GitHub App is required.
Existing release tags and GitHub Releases remain unchanged. The package stays at
`0.2.1` until the first Changesets version PR is merged; the pending notes propose
`1.0.0` because Node.js 18 and 20 support was removed in favor of Node.js 22+.

## Repository setup

Enable **Allow GitHub Actions to create and approve pull requests** in
**Settings > Actions > General > Workflow permissions**. Repository default
permissions can remain read-only; only the release job requests the writes it
needs. Retain normal human reviews, required checks, and the merge queue.

Keep the npm trusted publisher configured for owner `openai`, repository
`openai-guardrails-js`, and workflow `publish.yml`, with no environment requirement.
No npm token, App private key, or release environment is needed.
