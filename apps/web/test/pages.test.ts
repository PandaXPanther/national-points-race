import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

describe("public information architecture", () => {
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
    expect(reconstruction).toContain("champion.points");
    expect(reconstruction).not.toContain("<strong>619</strong>");
    expect(reconstruction).not.toContain("Evidence audit in progress");
    expect(report.standings).toHaveLength(100);
    expect(report.standings[0]?.name).toBe("Daphne Kalir-Starr");
    expect(report.standings[0]?.points).toBe(769);
    expect(report.completeness).toEqual({
      trackedLineages: 20,
      verifiedResultSources: 19,
      notHeld: 1,
      withheld: 0,
      normalizedResults: 662,
      scoredAwards: 462,
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
      expect.objectContaining({ name: "Daphne Kalir-Starr", points: 769 }),
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
});
