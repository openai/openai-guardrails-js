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
2. Review the version and release notes. Changesets authenticates with the
   `openai-sdks` GitHub App so release PR creation and updates trigger normal PR
   workflows. Wait for all required checks on the current PR commit and required
   review before merging through the merge queue.
   The **CI** workflow can also be run manually on `changeset-release/main` for
   diagnostics (`gh workflow run ci.yml --ref changeset-release/main`).
3. Merge the release PR. `publish.yml` builds, tests, and lints, then publishes the
   unpublished version to npm, creates a `v<version>` tag, and creates a GitHub
   Release from the changelog. The release PR selects the version and release
   notes for the normal Changesets publishing process.

### Publishing trust boundary

Protected `main` is the publishing trust boundary. Code merged into `main` is
trusted to use npm OIDC publishing authority, including during dependency
installation, builds, and tests. The job's `GITHUB_TOKEN` has only `contents: read`
for checkout and `id-token: write` for npm trusted publishing. The App token is
minted after installation, build, tests, and lint pass, immediately before
Changesets. The private key is passed only to the token action. Checkout does not
persist credentials, and Changesets uses its default GitHub API mode for commits
and tags, without installing App credentials in Git configuration.

Changesets passes the App token to its version and publish subprocesses as
`GITHUB_TOKEN`; their scripts, dependencies, and npm lifecycle hooks are part of
the trusted-main release boundary. Step ordering reduces token exposure but does
not isolate these processes from other code running in the same job. npm OIDC
authority remains available on main runs that prepare a version PR and manual
reruns on `main`.

The Changesets version PR controls the normal version/changelog release process;
it is not a separate credential-approval gate. The `publish` environment allows
only the exact `main` branch and has no required reviewers. SDK-team review of
the release PR is the human approval gate. Maintain branch protections,
code-owner review, required checks, and the
merge queue. Keep admin bypass disabled on the `publish` environment; do not add
the App to branch or ruleset bypass lists.

The workflow uses npm trusted publishing (OIDC) with Node 24 and its bundled npm. Keep the
npm trusted publisher configured for `openai/openai-guardrails-js` and the workflow
filename `publish.yml`, with the environment set to `publish`. When introducing
this binding, merge the workflow environment change and wait for all publish
runs using the old workflow to finish before restricting the npm publisher to
that environment. For recovery afterward, start a new workflow run on current
`main` rather than rerunning a pre-change workflow revision.
No npm token is needed. GitHub Actions must be allowed to
create pull requests in the repository settings.

The `publish` environment holds the `OPENAI_SDKS_APP_CLIENT_ID` variable and
`OPENAI_SDKS_APP_PRIVATE_KEY` secret for the installed `openai-sdks` App. Verify
credential presence using environment metadata only; never retrieve or print
private key material. The full-SHA-pinned `actions/create-github-app-token` action
requests a token for only the current repository, with `contents: write` and
`pull_requests: write`. The token expires after one hour and the action attempts
revocation in its post-job cleanup, including after failures. Do not disable that
cleanup or substitute a long-lived token.

Changesets uses this App token for version PRs, Git tags, and GitHub Releases;
npm publishing continues to use OIDC. Publishing happens in the same workflow as
tag creation. Changesets is the only release automation in this repository.

### App migration rollout

After the workflow change is reviewed and merged, inspect a new `publish.yml`
run on current `main`. Confirm the App token step succeeds, then verify that a
release PR created or updated by the App gets normal CI and CodeQL checks on its
current head. Do not bypass required review, checks, or the merge queue. A run
with no pending changesets may publish an unpublished version; it is not a dry
run. During the next approved release, verify npm publication, the matching
`v<version>` tag, and GitHub Release. Local workflow tests do not verify App
installation permissions, key validity, or an end-to-end production release.

If token creation fails, check installation access, environment variable/secret
metadata, and the App's repository permissions without exposing the key. Have
the credential owner repair provisioning, then start a new run on current
`main`. Do not weaken environment restrictions or change the npm trusted
publisher binding to recover. Avoid rerunning a pre-migration workflow revision;
if a rollback is necessary, review it as a workflow change and account for the
different PR workflow-trigger behavior of `GITHUB_TOKEN`.

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

The release workflow uses Changesets CLI 3.x with the compatible Changesets action
2.x on Node 24.
