import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("../scripts/package-pages.mjs", import.meta.url),
);

describe("Cloudflare Pages packaging", () => {
  it("removes Astro's Workers deployment redirect before a Pages upload", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain('join(appRoot, ".wrangler", "deploy")');
    expect(script).toContain("rmSync(astroDeployRedirect");
  });
});
