import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

const requiredPages = [
  "pages/index.astro",
  "pages/history.astro",
  "pages/methodology.astro",
  "pages/archive/index.astro",
  "pages/archive/[season].astro",
  "pages/corrections.astro",
  "pages/2025-26.astro",
  "pages/2026-27.astro",
  "pages/404.astro",
] as const;

describe("public information architecture", () => {
  it("publishes every required route", async () => {
    await expect(
      Promise.all(requiredPages.map((page) => access(`${sourceRoot}${page}`))),
    ).resolves.toHaveLength(requiredPages.length);
  });

  it("labels the reconstructed and live seasons distinctly", async () => {
    const home = await readFile(`${sourceRoot}pages/index.astro`, "utf8");
    const reconstruction = await readFile(
      `${sourceRoot}pages/2025-26.astro`,
      "utf8",
    );
    expect(home).toContain("Current live race");
    expect(reconstruction).toContain("Automated reconstruction");
    expect(reconstruction).toContain("not an official contemporaneous NPR");
  });

  it("credits the original race and describes independent stewardship", async () => {
    const history = await readFile(`${sourceRoot}pages/history.astro`, "utf8");
    expect(history).toContain("Extemp Central");
    expect(history).toContain("Logan Scisco");
    expect(history).toContain("Saras Totey");
    expect(history).toContain("independent");
  });
});
