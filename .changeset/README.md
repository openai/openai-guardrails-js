# Releases

This repository uses Changesets to release the single npm package
`@openai/guardrails`. Python dependencies in `pyproject.toml` only build the docs;
their project version is independent of npm releases.

## Contributing a release note

For a user-visible SDK change, run `npm run changeset`, choose the appropriate
patch, minor, or major bump, and write a short description of the change. Commit
the generated `.changeset/*.md` file with the code. Internal tooling and docs-only
changes do not require a release note.

Use `npm run changeset -- status` to preview pending releases. Do not manually bump
`package.json` or create a release tag as part of an ordinary code PR.

## Publishing

1. Merging changesets into `main` runs `publish.yml`, which creates or updates the
   `changeset-release/main` PR. It updates `package.json`, `package-lock.json`, and
   `CHANGELOG.md` and consumes the pending changesets.
2. Review the version and release notes. PRs created using `GITHUB_TOKEN` do not
   automatically trigger other workflows. Run the **CI** workflow manually on
   `changeset-release/main` before merging (for example,
   `gh workflow run ci.yml --ref changeset-release/main`), and check its result.
3. Merge the release PR. `publish.yml` builds, tests, and lints, then publishes the
   unpublished version to npm, creates a `v<version>` tag, and creates a GitHub
   Release from the changelog. Merging the release PR is approval to publish.

The workflow uses npm trusted publishing (OIDC) with Node 22 and npm 11. Keep the
npm trusted publisher configured for `openai/openai-guardrails-js` and the workflow
filename `publish.yml`. No npm token is needed. GitHub Actions must be allowed to
create pull requests in the repository settings.

The **Publish Package** workflow can be manually rerun on `main` after a failure.
Changesets skips versions already published to npm. If npm publishing succeeded
but tag or GitHub Release creation failed, inspect the original run and restore
only the missing tag/release at that run's commit; do not bump or republish the
version to recover GitHub metadata.

## Migration from manual releases

The existing `v0.2.1` and earlier tags and GitHub Releases remain unchanged.
Changesets continues the same `v<version>` naming for this single-package repo.
Historical release notes remain in GitHub Releases; the generated changelog starts
with the first Changesets release. The initial changeset records the unreleased
RequestOptions support from PR #63 and proposes version `0.3.0`.

Pushing a tag no longer triggers npm publishing. Publishing and tag creation now
happen together after merging the version PR, preventing a second tag-triggered
publish of the same version.

The CLI stays on Changesets 2.x to preserve the SDK repository's Node 18 developer
compatibility; Changesets 3.x requires a newer Node version. The release workflow
uses the compatible Changesets action 1.x.
