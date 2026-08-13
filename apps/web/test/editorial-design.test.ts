import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

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

  it("gives the major routes distinct editorial compositions", async () => {
    const [home, history, method, reconstruction, current] = await Promise.all([
      readFile(`${sourceRoot}pages/index.astro`, "utf8"),
      readFile(`${sourceRoot}pages/history.astro`, "utf8"),
      readFile(`${sourceRoot}pages/methodology.astro`, "utf8"),
      readFile(`${sourceRoot}pages/2025-26.astro`, "utf8"),
      readFile(`${sourceRoot}pages/2026-27.astro`, "utf8"),
    ]);

    expect(home).toContain('class="cover-grid"');
    expect(history).toContain('class="chronology"');
    expect(method).toContain('class="method-index"');
    expect(method).toContain('class="method-ledger"');
    expect(reconstruction).toContain('class="champion-scoreline"');
    expect(current).toContain('class="preseason-register"');
  });

  it("keeps the shared frame compact and free of generic card grids", async () => {
    const [globalStyles, header, layout] = await Promise.all([
      readFile(`${sourceRoot}styles/global.css`, "utf8"),
      readFile(`${sourceRoot}components/SiteHeader.astro`, "utf8"),
      readFile(`${sourceRoot}layouts/SiteLayout.astro`, "utf8"),
    ]);

    expect(globalStyles).not.toMatch(/\.card-grid|\.stats-grid/iu);
    expect(header).toContain("2026-27 edition");
    expect(header).toContain('class="nav-scroll"');
    expect(layout).toContain('class="footer-lines"');
  });
});
