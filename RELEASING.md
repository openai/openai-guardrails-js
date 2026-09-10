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
Existing release tags and GitHub Releases remain unchanged. Version `0.3.0` is
the first release managed by Changesets; see the [changelog](CHANGELOG.md) and
[upgrade guide](docs/sdk_migration.md) for its changes. Keep the package pre-1.0
until an explicit stable-release decision,
using minor bumps for features and breaking changes and patches for compatible
fixes. Version `0.3.0` requires Node.js `^22.13.0 || >=24.0.0`, including removal of
Node.js 18 and 20 support.

## Publishing authority

Protected `main` is the publishing trust boundary. Every main-branch release
workflow run, including version-PR preparation, may use npm OIDC and the repository
`GITHUB_TOKEN`. Merging a version PR controls the normal Changesets release
process; it is not a separate credential-approval gate. Keep branch protections
and reviews enforced, and restrict administrative bypass access.

## Repository setup

Enable **Allow GitHub Actions to create and approve pull requests** in
**Settings > Actions > General > Workflow permissions**. Repository default
permissions can remain read-only; only the release job requests the writes it
needs. Retain normal human reviews, required checks, and the merge queue.

Configure the GitHub `publish` environment to allow only the exact `main` branch,
with no required reviewers. SDK-team review of the release PR is the human
approval gate.

Keep the npm trusted publisher configured for owner `openai`, repository
`openai-guardrails-js`, workflow `publish.yml`, and environment `publish`.
Follow the [environment rollout and recovery instructions](.changeset/README.md#publishing-trust-boundary)
before tightening an existing publisher binding. No npm token or App private key
is needed.
