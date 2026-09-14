import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
// Check credential boundaries in the actual workflow without executing a release.
const steps = workflow.split(/^ {6}- /m).slice(1);
const tokenStep = steps.find((step) => step.includes('actions/create-github-app-token@'));
const changesetsStep = steps.find((step) => step.includes('changesets/action@'));

describe('publish workflow authentication', () => {
  it('gates the release job on exact main and preserves npm OIDC in publish', () => {
    expect(workflow).toContain("    if: github.ref == 'refs/heads/main'\n");
    expect(workflow).toContain('    environment: publish\n');
    expect(workflow).toMatch(/branches: \[ main \]/);
    expect(workflow).not.toMatch(/pull_request|pull_request_target|workflow_run/);
    expect(workflow).toMatch(/^permissions: \{\}$/m);
    const permissions = workflow.match(/ {4}permissions:\n([\s\S]*?) {4}steps:/)?.[1];
    expect(permissions?.replace(/ #[^\n]*/g, '')).toBe(
      '      contents: read\n      id-token: write\n'
    );
    expect(workflow).toContain("          node-version: '24'\n");
    expect(workflow).toContain("          registry-url: 'https://registry.npmjs.org'\n");
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('requests only current-repository contents and PR writes with automatic revocation', () => {
    expect(tokenStep).toBeDefined();
    expect(tokenStep).toMatch(/actions\/create-github-app-token@[a-f0-9]{40} #/);
    expect(tokenStep).toContain('        id: release-token\n');
    expect(tokenStep).toContain(`          client-id: \${{ vars.OPENAI_SDKS_APP_CLIENT_ID }}\n`);
    expect(tokenStep).toContain(
      `          private-key: \${{ secrets.OPENAI_SDKS_APP_PRIVATE_KEY }}\n`
    );
    expect(tokenStep).toContain(`          owner: \${{ github.repository_owner }}\n`);
    expect(tokenStep).toContain(`          repositories: \${{ github.event.repository.name }}\n`);
    expect(tokenStep?.match(/^ {10}permission-.*$/gm)).toEqual([
      '          permission-contents: write',
      '          permission-pull-requests: write',
    ]);
    expect(tokenStep).toContain('          skip-token-revoke: false\n');
  });

  it('mints after validation and confines the key and token to their consuming actions', () => {
    const tokenIndex = steps.indexOf(tokenStep ?? '');
    const changesetsIndex = steps.indexOf(changesetsStep ?? '');
    expect(tokenIndex).toBeGreaterThan(0);
    expect(changesetsIndex).toBe(tokenIndex + 1);
    expect(changesetsIndex).toBe(steps.length - 1);
    const beforeMint = steps.slice(0, tokenIndex).join('\n');
    for (const command of [
      'npm ci',
      'npm run build --if-present',
      'npm run test -- --run',
      'npm run lint',
    ]) {
      expect(beforeMint).toContain(`run: ${command}\n`);
    }
    expect(beforeMint).toContain('          persist-credentials: false\n');
    expect(beforeMint).not.toMatch(/OPENAI_SDKS_APP|release-token|github-token:|token:/);
    expect(workflow.match(/secrets\./g)).toHaveLength(1);
    expect(workflow.match(/steps\.release-token\.outputs\.token/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/^\s*env:/m);
  });

  it('passes the App token to Changesets while preserving version and publish scripts', () => {
    expect(changesetsStep).toContain(
      `          github-token: \${{ steps.release-token.outputs.token }}`
    );
    expect(changesetsStep).toContain('          version-script: npm run version-packages\n');
    expect(changesetsStep).toContain('          publish-script: npm run release\n');
    expect(changesetsStep).not.toMatch(/push-with-git-cli|push-git-tags|create-github-releases/);
    expect(workflow).not.toContain('secrets.GITHUB_TOKEN');
  });
});
