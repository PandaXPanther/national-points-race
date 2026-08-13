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
      readonly standings: readonly {
        readonly name: string;
        readonly points: number;
      }[];
      readonly completeness: {
        readonly verifiedResultSources: number;
        readonly notHeld: number;
        readonly withheld: number;
      };
    };

    expect(reconstruction).toContain("StandingsTable");
    expect(reconstruction).toContain("report.standings");
    expect(reconstruction).not.toContain("Evidence audit in progress");
    expect(report.standings).toHaveLength(100);
    expect(report.standings[0]?.name).toBe("Daphne Kalir-Starr");
    expect(report.standings[0]?.points).toBe(619);
    expect(report.completeness).toEqual({
      trackedLineages: 20,
      verifiedResultSources: 18,
      notHeld: 1,
      withheld: 1,
      normalizedResults: 656,
      scoredAwards: 456,
    });
  });

  it("records Daphne Kalir-Starr as the reconstructed 2025-26 champion", async () => {
    const seasons = JSON.parse(
      await readFile(`${sourceRoot}data/history/seasons.json`, "utf8"),
    ) as readonly {
      readonly seasonId: string;
      readonly winner: {
        readonly name: string;
        readonly points: number;
      } | null;
    }[];
    const reconstruction = seasons.find(
      ({ seasonId }) => seasonId === "2025-26",
    );

    expect(reconstruction?.winner).toEqual(
      expect.objectContaining({ name: "Daphne Kalir-Starr", points: 619 }),
    );
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

  it("publishes the current 21-tournament policy and ASU addition", async () => {
    const [current, methodology] = await Promise.all([
      readFile(`${sourceRoot}pages/2026-27.astro`, "utf8"),
      readFile(`${sourceRoot}pages/methodology.astro`, "utf8"),
    ]);
    expect(current).toContain("npr-2026-27-v1");
    expect(current).toContain("21");
    expect(methodology).toContain("Arizona State HDSHC Invitational");
    expect(methodology).toContain("Tier 4");
  });
});
