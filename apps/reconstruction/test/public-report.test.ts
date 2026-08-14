import { describe, expect, it } from "vitest";

import { rebuildSeason } from "@points-race/pipeline";

import {
  buildPublicReconstructionReport,
  chooseDisplaySchool,
} from "../src/public-report.js";
import { REVIEWED_MBA_2025_26 } from "../src/mba-reviewed.js";
import { REVIEWED_SPEECHWIRE_2025_26 } from "../src/speechwire-reviewed.js";
import { build2025_26RebuildInput } from "../src/season-2025-26.js";

describe("public reconstruction report", () => {
  it("publishes a complete twenty-lineage audit without overstating gaps", () => {
    const input = build2025_26RebuildInput([], REVIEWED_SPEECHWIRE_2025_26, [
      REVIEWED_MBA_2025_26,
    ]);
    const output = rebuildSeason(input);
    const report = buildPublicReconstructionReport(input, output);

    expect(report.tournaments).toHaveLength(20);
    expect(
      report.tournaments.filter(({ status }) => status === "final"),
    ).toHaveLength(4);
    expect(
      report.tournaments.find(
        ({ lineageId }) => lineageId === "apple-valley-minneapple",
      ),
    ).toMatchObject({ status: "not-held" });
    expect(
      report.tournaments.find(
        ({ lineageId }) => lineageId === "mba-round-robin",
      ),
    ).toMatchObject({
      status: "final",
      resultCount: 6,
      awardCount: 6,
      source: {
        sha256:
          "b293c39e868455d2ea75214575e15e0df1e1d573161422ff0f30fd403da54cc3",
      },
    });
    expect(report.caveat).not.toContain("MBA");
    expect(report.status).toBe("provisional");
    expect(report.standings).toHaveLength(
      Math.min(100, output.standings.length),
    );
    expect(report.standings[0]?.rank).toBe(1);
    expect(report.diagnostics).toEqual({ identity: 0, rebuild: 0 });
  });

  it("prefers repeated named schools over export placeholders", () => {
    expect(
      chooseDisplaySchool([
        "School not included in Tabroom export 37602",
        "Plano West",
        "Plano West Sr High School",
        "Plano West Sr High School",
      ]),
    ).toBe("Plano West Sr High School");
  });

  it("contains no em dash in public output", () => {
    const input = build2025_26RebuildInput([], REVIEWED_SPEECHWIRE_2025_26, [
      REVIEWED_MBA_2025_26,
    ]);
    const report = buildPublicReconstructionReport(input, rebuildSeason(input));

    expect(JSON.stringify(report)).not.toContain("\u2014");
  });
});
