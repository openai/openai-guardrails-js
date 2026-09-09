# Releasing @openai/guardrails

Releases use the `openai-sdks` GitHub App and release-please, following
[openai-node](https://github.com/openai/openai-node/blob/main/.github/workflows/create-releases.yml).

## One-time administrator setup

Complete this setup before merging the release workflow:

1. Ask an OpenAI organization GitHub App administrator to grant the existing
   `openai-sdks` installation access to `openai/openai-guardrails-js`. It needs
   **Contents**, **Issues**, and **Pull requests** read/write permissions.
2. Create a GitHub Actions environment named `release` in this repository and
   restrict its deployment branches to `main` only. Configure any required
   release approvals according to the SDK team's policy.
3. In that environment, set `OPENAI_SDKS_APP_CLIENT_ID` to the existing App's
   client ID (`Iv23li2AtcmhLHO07J87`, also used by openai-node). Have the App's
   credential owner provision `OPENAI_SDKS_APP_PRIVATE_KEY` as an environment
   secret through the approved secret-management process. Never put the private
   key in Git, issues, or chat. GitHub cannot copy or reveal another repository's
   stored secret.
4. Confirm repository rules allow the App to create release branches, PRs, and
   `v*` tags. Release PRs should still use the normal review, required checks,
   and merge queue; the App does not need to bypass protection on `main`.
5. Confirm the npm trusted publisher for `@openai/guardrails` names owner
   `openai`, repository `openai-guardrails-js`, and workflow `publish.yml`,
   with no environment requirement (the existing publish job has none).
   Publishing remains in that workflow; the App credentials only orchestrate
   GitHub releases.

## Normal release process

1. Merge changes to `main` using Conventional Commit titles, such as `fix:` or
   `feat:`. The **Create releases** workflow opens or updates a release PR under
   the App's identity. The Node release strategy updates `package.json`,
   `package-lock.json`, the release manifest, and `CHANGELOG.md`.
2. Review the generated version and changelog, wait for CI, and merge the release
   PR through the normal process. The manifest starts at the existing `0.2.1`
   release; pre-1.0 breaking changes bump the minor version.
3. The next **Create releases** run creates the GitHub release and a `v*` tag.
   Because it uses an App installation token, the tag triggers **Publish
   Package** (`.github/workflows/publish.yml`), which builds, tests, and publishes
   through npm trusted publishing. Monitor both workflows to completion and
   verify the resulting version on npm.

## Recovery and verification

- After administrator setup, run **Create releases** manually on `main` if
  needed. It can create a release for an already merged release PR, so treat
  this as a release operation. Dispatches on other branches are skipped.
- If App token creation fails, check installation access, the environment's
  client ID/private key, and the three requested App permissions.
- If the GitHub release succeeds but publishing fails, inspect **Publish
  Package**, fix the underlying cause, and rerun the failed publishing job.
  Check npm first in case publication succeeded before a later error. Do not
  delete and recreate a release tag or try to overwrite an npm version.
- Verify the first App-created release PR receives normal CI checks and its tag
  starts **Publish Package**. This end-to-end check requires the administrator
  credentials and an actual release; local validation cannot establish it.
