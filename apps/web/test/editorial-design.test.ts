import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const appRoot = fileURLToPath(new URL("../", import.meta.url));

describe("editorial frontend", () => {
  it("uses the approved near-monochrome palette", async () => {
    const tokens = await readFile(`${sourceRoot}styles/tokens.css`, "utf8");

    expect(tokens).toContain("--paper: #fbfaf7");
    expect(tokens).toContain("--paper-raised: #ffffff");
    expect(tokens).toContain("--ink: #121212");
    expect(tokens).toContain("--ink-soft: #5c5c59");
    expect(tokens).toContain("--rule: #d8d5ce");
    expect(tokens).toContain("--rule-dark: #8e8b84");
    expect(tokens).toContain("--link: #183b56");
    expect(tokens).toContain("--success: #2d5b45");
    expect(tokens).toContain("--error: #9a3428");
    expect(tokens).not.toMatch(/burgundy|gold|purple/iu);
  });

  it("uses only Inter and Source Serif 4 as branded typefaces", async () => {
    const [tokens, globalStyles] = await Promise.all([
      readFile(`${sourceRoot}styles/tokens.css`, "utf8"),
      readFile(`${sourceRoot}styles/global.css`, "utf8"),
    ]);
    const styles = `${tokens}\n${globalStyles}`;

    expect(styles).toContain('"Inter Variable"');
    expect(styles).toContain('"Source Serif 4 Variable"');
    expect(globalStyles).toContain("@fontsource-variable/inter");
    expect(globalStyles).toContain("@fontsource-variable/source-serif-4");
    expect(styles).not.toMatch(/Georgia|Times New Roman|Segoe UI/iu);
  });

  it("keeps the shared frame compact and free of generic card grids", async () => {
    const [globalStyles, header, layout] = await Promise.all([
      readFile(`${sourceRoot}styles/global.css`, "utf8"),
      readFile(`${sourceRoot}components/SiteHeader.astro`, "utf8"),
      readFile(`${sourceRoot}layouts/SiteLayout.astro`, "utf8"),
    ]);

    expect(globalStyles).not.toMatch(/\.card-grid|\.stats-grid/iu);
    expect(header).toContain('class="nav-scroll"');
    expect(layout).toMatch(/class="[^"]*\bfooter-lines\b[^"]*"/u);
  });

  it("provides a reproducible route and overflow visual audit", async () => {
    const scriptPath = `${appRoot}scripts/visual-audit.mjs`;
    await expect(access(scriptPath)).resolves.toBeUndefined();
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain('"/methodology/"');
    expect(script).toContain('"/archive/2024-25/"');
    expect(script).toContain('"/2025-26/competitors/1/"');
    expect(script).toContain("width: 320");
    expect(script).toContain("scrollWidth");
    expect(script).toContain("clientWidth");
    expect(script).toContain("heroTitleRect");
    expect(script).toContain("editionLabelRect");
    expect(script).toContain("heroOverlap");
    expect(script).toContain("captureBeyondViewport");
  });

  it("uses a collision-free mobile cover composition", async () => {
    const home = await readFile(`${sourceRoot}pages/index.astro`, "utf8");

    expect(home).toMatch(
      /@media \(max-width: 34rem\)[\s\S]*\.cover-title\s*\{[\s\S]*display:\s*grid/u,
    );
    expect(home).toMatch(
      /@media \(max-width: 34rem\)[\s\S]*\.edition-label\s*\{[\s\S]*position:\s*static[\s\S]*writing-mode:\s*horizontal-tb/u,
    );
    expect(home).toMatch(
      /@media \(max-width: 34rem\)[\s\S]*\.cover h1\s*\{[\s\S]*grid-column:\s*1 \/ -1/u,
    );
  });
});
