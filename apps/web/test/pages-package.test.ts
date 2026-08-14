import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("../scripts/package-pages.mjs", import.meta.url),
);
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

describe("Cloudflare Pages packaging", () => {
  it("removes Astro's Workers deployment redirect before a Pages upload", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain('join(appRoot, ".wrangler", "deploy")');
    expect(script).toContain("rmSync(astroDeployRedirect");
  });

  it("keeps discovery endpoints on the Pages Worker path", async () => {
    const [robots, sitemap] = await Promise.all([
      readFile(`${sourceRoot}pages/robots.txt.ts`, "utf8"),
      readFile(`${sourceRoot}pages/sitemap.xml.ts`, "utf8"),
    ]);

    expect(robots).not.toContain("prerender = true");
    expect(sitemap).not.toContain("prerender = true");
  });
});
