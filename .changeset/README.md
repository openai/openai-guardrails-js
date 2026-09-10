# Releases

This repository uses Changesets to release the single npm package
`@openai/guardrails`. VitePress builds the documentation separately from npm
releases.

## Contributing a release note

For a user-visible SDK change, run `npm run changeset`, choose the appropriate
patch or minor bump, and write a short description of the change. Commit
the generated `.changeset/*.md` file with the code.

Keep `@openai/guardrails` pre-1.0 until an explicit stable-release decision. While
the package is on `0.x`, use minor bumps for features and breaking changes, and
patch bumps for compatible fixes. Clearly describe breaking changes and required
migration steps in the release note. A major changeset selects `1.0.0` and should
only be used when the stable release is explicitly approved.

Add an entry for changes that materially affect package users: new features,
bug fixes, public APIs or types, deprecations, breaking changes, and meaningful
runtime performance or security improvements. Include dependency, build, or
packaging changes when they affect installation, supported environments, or
runtime behavior.

Do not add entries for internal tooling, CI, release automation, tests,
documentation-only edits, or refactoring without user-visible effects. For
example, upgrading a CI action needs no entry; fixing missing files in the
published npm package does. Describe what users experience and any migration
steps, rather than internal implementation details.

Code reviewers should require a matching, accurate changeset for material
user-facing changes and check its version-bump level. They should not request
one for internal-only changes or ask generated release PRs for another changeset.
See [agent and code-review guidance](../AGENTS.md).

Use `npm run changeset -- status` to preview pending releases. Do not manually bump
`package.json` or create a release tag as part of an ordinary code PR.

## Publishing

1. Merging changesets into `main` runs `publish.yml`, which creates or updates the
   `changeset-release/main` PR. It updates `package.json`, `package-lock.json`, and
   `CHANGELOG.md` and consumes the pending changesets.
2. Review the version and release notes. For PRs created or updated using
   `GITHUB_TOKEN`, select **Approve workflows to run** when GitHub requests it,
   then wait for all required checks on the current PR commit before merging.
   [GitHub documents this approval requirement](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
   The **CI** workflow can also be run manually on `changeset-release/main` for
   diagnostics (`gh workflow run ci.yml --ref changeset-release/main`).
3. Merge the release PR. `publish.yml` builds, tests, and lints, then publishes the
   unpublished version to npm, creates a `v<version>` tag, and creates a GitHub
   Release from the changelog. The release PR selects the version and release
   notes for the normal Changesets publishing process.

### Publishing trust boundary

Protected `main` is the publishing trust boundary. Code merged into `main` is
trusted to use the release job's GitHub token and npm OIDC publishing authority,
including during dependency installation, builds, and tests. These permissions
are intentionally available on every main-branch release workflow run, including
runs that prepare a version PR and manual reruns on `main`.

The Changesets version PR controls the normal version/changelog release process;
it is not a separate credential-approval gate. The `publish` environment allows
only the exact `main` branch and has no required reviewers. SDK-team review of
the release PR is the human approval gate. Maintain branch protections,
code-owner review, required checks, and the
merge queue, and restrict access to any administrative bypasses.

The workflow uses npm trusted publishing (OIDC) with Node 24 and its bundled npm. Keep the
npm trusted publisher configured for `openai/openai-guardrails-js` and the workflow
filename `publish.yml`, with the environment set to `publish`. When introducing
this binding, merge the workflow environment change and wait for all publish
runs using the old workflow to finish before restricting the npm publisher to
that environment. For recovery afterward, start a new workflow run on current
`main` rather than rerunning a pre-change workflow revision.
No npm token is needed. GitHub Actions must be allowed to
create pull requests in the repository settings.

Changesets uses the repository's `GITHUB_TOKEN` for version PRs, Git tags, and
GitHub Releases. No GitHub App is required. Publishing happens in the same
workflow as tag creation, so it does not depend on token-created tags triggering
another workflow. Changesets is the only release automation in this repository.

The **Publish Package** workflow can be manually rerun on `main` after a failure.
Changesets skips versions already published to npm. If npm publishing succeeded
but tag or GitHub Release creation failed, inspect the original run and restore
only the missing tag/release at that run's commit; do not bump or republish the
version to recover GitHub metadata.

## Migration from manual releases

The existing `v0.2.1` and earlier tags and GitHub Releases remain unchanged.
Changesets continues the same `v<version>` naming for this single-package repo.
Historical release notes remain in GitHub Releases. The generated
[changelog](../CHANGELOG.md) starts at `0.3.0`, the first release managed by
Changesets. Its initial changesets are consumed into the changelog, which records
the user-facing changes since `v0.2.1`. See the
[upgrade guide](../docs/sdk_migration.md) for the breaking Node.js and SDK
requirements. CI, tests, chores, documentation, and TypeScript cleanup are
excluded from release notes.

Pushing a tag no longer triggers npm publishing. Publishing and tag creation now
happen together after merging the version PR, preventing a second tag-triggered
publish of the same version.

The release workflow uses Changesets CLI 2.x with the compatible Changesets action
1.x on Node 24.
