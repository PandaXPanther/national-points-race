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

  it("publishes the audited 2025-26 proof standings and source status", async () => {
    const reconstruction = await readFile(
      `${sourceRoot}pages/2025-26.astro`,
      "utf8",
    );
    const report = JSON.parse(
      await readFile(`${sourceRoot}data/reconstruction/2025-26.json`, "utf8"),
    ) as {
      readonly standings: readonly { readonly name: string }[];
      readonly completeness: {
        readonly verifiedResultSources: number;
        readonly notHeld: number;
        readonly withheld: number;
      };
    };

    expect(reconstruction).toContain("StandingsTable");
    expect(reconstruction).toContain("report.standings");
    expect(reconstruction).not.toContain("Evidence audit in progress");
    expect(report.standings).toHaveLength(25);
    expect(report.standings[0]?.name).toBe("Daphne Kalir-Starr");
    expect(report.completeness).toEqual({
      trackedLineages: 20,
      verifiedResultSources: 18,
      notHeld: 1,
      withheld: 1,
      normalizedResults: 656,
      scoredAwards: 456,
    });
  });

  it("credits the original race and describes independent stewardship", async () => {
    const history = await readFile(`${sourceRoot}pages/history.astro`, "utf8");
    expect(history).toContain("Extemp Central");
    expect(history).toContain("Logan Scisco");
    expect(history).toContain(
      '<a href="https://sarastotey.com">Saras Totey</a>',
    );
    expect(history).toContain("independent");
  });
});
