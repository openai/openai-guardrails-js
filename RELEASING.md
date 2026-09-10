# Releasing @openai/guardrails

Release-please uses the repository's `GITHUB_TOKEN` to open and update release
PRs. A maintainer creates the release tag after merging the reviewed PR; the tag
starts the existing npm trusted-publishing workflow.

## Repository setup

In **Settings > Actions > General > Workflow permissions**, enable **Allow
GitHub Actions to create and approve pull requests**. The workflow requests
Contents, Issues, and Pull requests write permissions only for its release job;
the repository's default workflow permissions can remain read-only. Release PRs
still require normal human review, required checks, and the merge queue.

No App installation, private key, or release environment is required. Migration
to `openai-sdks` is deferred to SDK-533 in Linear.

The existing npm trusted publisher for `@openai/guardrails` should name owner
`openai`, repository `openai-guardrails-js`, and workflow `publish.yml`, with no
environment requirement (the publish job has none).

## First automated release

Before merging the first generated release PR, reconcile its proposed version
and changelog with all changes since `v0.2.1` (`git log v0.2.1..main`). Historical
commits do not all use Conventional Commit titles, so generated notes alone are
not a complete inventory.

In particular, [PR #63](https://github.com/openai/openai-guardrails-js/pull/63)
added the `RequestOptions` parameter to response and chat creation methods under
a non-Conventional title. Include that feature in the first release's changelog
and explicitly review whether the proposed version reflects the unreleased
features before approving the release PR. Do not assume a generated patch bump
has accounted for those changes.

## Normal release process

1. Merge changes to `main` using Conventional Commit titles, such as `fix:` or
   `feat:`. The **Create release PRs** workflow opens or updates a release PR as
   `github-actions[bot]`. The Node release strategy updates `package.json`,
   `package-lock.json`, the release manifest, and `CHANGELOG.md`.
2. A maintainer with write access must select **Approve workflows to run** on
   the release PR when GitHub requests it, including after automated updates.
   [GitHub requires approval for PR workflow runs triggered by `GITHUB_TOKEN`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
   Wait for the checks on the current PR commit; do not bypass required checks.
3. Review the generated version and changelog and merge through the normal
   process. The manifest starts at the existing `0.2.1` release; pre-1.0 breaking
   changes bump the minor version. Apply the first-release checklist above.
4. Once CI passes on the merged release commit, use your normal maintainer Git
   credentials to create and push a `v<version>` tag at that exact commit. Verify
   the version in its `package.json` matches the tag. This tag push starts
   **Publish Package** (`.github/workflows/publish.yml`), which builds, tests,
   and publishes through npm trusted publishing. Monitor it to completion and
   verify the version on npm.
5. Create the GitHub release from that existing tag using the reviewed changelog.
   On the merged release PR, remove `autorelease: pending` and add
   `autorelease: tagged` (create the latter label if necessary). Release-please
   waits while a merged release PR still has the pending label, so complete
   these steps before expecting the next release PR.

GitHub release/tag creation is intentionally disabled in release-please with
`skip-github-release: true`: tags pushed with `GITHUB_TOKEN` would not trigger
the existing publisher. Manual workflow dispatch only updates release PRs.

## Recovery and verification

- Run **Create release PRs** manually on `main` if needed. Dispatches on other
  branches are skipped.
- If PR creation is rejected, check the repository's Actions PR-creation setting
  and any organization policy that restricts it.
- If a new release PR is blocked by an outstanding merged release, finish its
  manual tagging, publication, GitHub release, and label updates above.
- If publishing fails after tagging, inspect **Publish
  Package**, fix the underlying cause, and rerun the failed publishing job.
  Check npm first in case publication succeeded before a later error. Do not
  delete and recreate a release tag or try to overwrite an npm version.
- Verify the first bot-created release PR receives CI checks after maintainer
  approval and the maintainer-pushed tag starts **Publish Package**. This
  end-to-end check requires an actual release; local validation cannot establish
  it.
