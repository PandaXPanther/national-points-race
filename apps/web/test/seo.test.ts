import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = `${appRoot}src/`;
const publicRoot = `${appRoot}public/`;

describe("public discovery metadata", () => {
  it("uses the intended apex as the Astro site origin", async () => {
    const config = await readFile(`${appRoot}astro.config.mjs`, "utf8");

    expect(config).toContain('site: "https://extempcentral.org"');
    expect(config).not.toContain("national-points-race.pages.dev");
  });

  it("publishes canonical, social, icon, and structured metadata", async () => {
    const layout = await readFile(
      `${sourceRoot}layouts/SiteLayout.astro`,
      "utf8",
    );

    expect(layout).toContain('rel="canonical"');
    expect(layout).toContain('property="og:site_name"');
    expect(layout).toContain('property="og:image"');
    expect(layout).toContain('name="twitter:card"');
    expect(layout).toContain('rel="icon"');
    expect(layout).toContain('rel="apple-touch-icon"');
    expect(layout).toContain('rel="manifest"');
    expect(layout).toContain('type="application/ld+json"');
  });

  it("publishes robots, sitemap, manifest, and branded image assets", async () => {
    await expect(
      Promise.all(
        [
          `${sourceRoot}pages/robots.txt.ts`,
          `${sourceRoot}pages/sitemap.xml.ts`,
          `${publicRoot}favicon.svg`,
          `${publicRoot}favicon-32x32.png`,
          `${publicRoot}apple-touch-icon.png`,
          `${publicRoot}social-card.png`,
          `${publicRoot}site.webmanifest`,
        ].map((path) => access(path)),
      ),
    ).resolves.toHaveLength(7);
  });

  it("targets the apex in robots", async () => {
    const robots = await readFile(`${sourceRoot}pages/robots.txt.ts`, "utf8");
    expect(robots).toContain("https://extempcentral.org/sitemap.xml");
  });

  it("assigns structured data to the major editorial routes", async () => {
    const [home, history, method, reconstruction] = await Promise.all([
      readFile(`${sourceRoot}pages/index.astro`, "utf8"),
      readFile(`${sourceRoot}pages/history.astro`, "utf8"),
      readFile(`${sourceRoot}pages/methodology.astro`, "utf8"),
      readFile(`${sourceRoot}pages/2025-26.astro`, "utf8"),
    ]);

    expect(home).toContain('"@type": "WebSite"');
    expect(history).toContain('"@type": "Article"');
    expect(method).toContain('"@type": "Article"');
    expect(reconstruction).toContain('"@type": "Dataset"');
  });
});
