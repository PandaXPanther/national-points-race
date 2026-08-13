import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workflowPath = `${repositoryRoot}.github/workflows/validate-and-deploy-pages.yml`;
const operationsPath = `${repositoryRoot}docs/operations/github-pages-deployment.md`;

describe("GitHub Pages deployment workflow", () => {
  it("validates pull requests and main before deploying the exact main commit", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm format:check");
    expect(workflow).toContain("pnpm lint");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("verify:2025-26");
    expect(workflow).toContain("pnpm --filter @points-race/web build");
    expect(workflow).toContain("project-name national-points-race");
    expect(workflow).toContain("--commit-hash $GITHUB_SHA");
    expect(workflow).toContain("secrets.CLOUDFLARE_API_TOKEN");
    expect(workflow).toContain("secrets.CLOUDFLARE_ACCOUNT_ID");
    expect(workflow).toContain("env.CLOUDFLARE_API_TOKEN != ''");
    expect(workflow).toContain("env.CLOUDFLARE_ACCOUNT_ID != ''");
  });

  it("documents the one-time secret setup and production behavior", async () => {
    await expect(access(operationsPath)).resolves.toBeUndefined();
    const operations = await readFile(operationsPath, "utf8");

    expect(operations).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(operations).toContain("CLOUDFLARE_API_TOKEN");
    expect(operations).toContain("national-points-race");
    expect(operations).toContain("main");
    expect(operations).toContain("pull request");
  });
});
