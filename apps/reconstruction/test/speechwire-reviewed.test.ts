import { describe, expect, it } from "vitest";

import { rebuildSeason } from "@points-race/pipeline";

import {
  REVIEWED_SPEECHWIRE_2025_26,
  buildReviewedSpeechWireEvidence,
} from "../src/speechwire-reviewed.js";
import { build2025_26RebuildInput } from "../src/season-2025-26.js";

describe("reviewed 2025-26 SpeechWire evidence", () => {
  it("pins three official packets and their corroborating finals pages", () => {
    expect(REVIEWED_SPEECHWIRE_2025_26).toHaveLength(3);
    expect(
      REVIEWED_SPEECHWIRE_2025_26.map(({ source }) => ({
        tournamentId: source.tournamentId,
        byteLength: source.byteLength,
        sha256: source.sha256,
        corroborationCount: source.corroborationUrls.length,
      })),
    ).toEqual([
      {
        tournamentId: 19709,
        byteLength: 970_779,
        sha256:
          "71389783a91b7646c3eddde3b9fe8e25e9284f60f1595248da94db52fc471bf9",
        corroborationCount: 1,
      },
      {
        tournamentId: 21511,
        byteLength: 231_936,
        sha256:
          "ab4acd48980f65c649e6ae274202f6d613f98678cc19be1577428ab5961df36d",
        corroborationCount: 1,
      },
      {
        tournamentId: 20612,
        byteLength: 2_901_108,
        sha256:
          "70ceddab67477fd454e62cac41986caded0bce3b99971341a02a67f675351a3a",
        corroborationCount: 2,
      },
    ]);
  });

  it("contains exactly the point-relevant rows and stage distributions", () => {
    const evidence = buildReviewedSpeechWireEvidence(
      REVIEWED_SPEECHWIRE_2025_26,
    );

    expect(evidence.resultSets).toHaveLength(4);
    expect(evidence.resultSets.flatMap(({ results }) => results)).toHaveLength(
      42,
    );
    expect(
      evidence.resultSets.map((resultSet) => ({
        lineageId: resultSet.lineageId,
        division: resultSet.event.division,
        finalists: resultSet.results.filter(
          ({ furthestStage }) => furthestStage === "final",
        ).length,
        semifinalists: resultSet.results.filter(
          ({ furthestStage }) => furthestStage === "semifinal",
        ).length,
      })),
    ).toEqual([
      {
        lineageId: "george-mason",
        division: "combined",
        finalists: 6,
        semifinalists: 0,
      },
      {
        lineageId: "extemp-toc",
        division: "combined",
        finalists: 6,
        semifinalists: 6,
      },
      {
        lineageId: "nietoc",
        division: "ix",
        finalists: 6,
        semifinalists: 6,
      },
      {
        lineageId: "nietoc",
        division: "usx",
        finalists: 6,
        semifinalists: 6,
      },
    ]);
  });

  it("matches every officially published finalist in exact placement order", () => {
    const evidence = buildReviewedSpeechWireEvidence(
      REVIEWED_SPEECHWIRE_2025_26,
    );
    const finalists = Object.fromEntries(
      evidence.resultSets.map((resultSet) => [
        `${resultSet.lineageId}:${resultSet.event.division}`,
        resultSet.results
          .filter(({ placement }) => placement !== null)
          .sort((left, right) => left.placement! - right.placement!)
          .map(({ publishedName }) => publishedName),
      ]),
    );

    expect(finalists).toEqual({
      "george-mason:combined": [
        "Aparna Iyer",
        "Sadie Zwonitzer",
        "Arjun Kumar",
        "Kajal Parmar",
        "Anna Benjamin",
        "Isabella Murillo",
      ],
      "extemp-toc:combined": [
        "Rohan Dash",
        "Sylvia Oglesbay",
        "Angelo Ferris",
        "Simon Forbes",
        "Kajal Parmar",
        "Varshini Arun",
      ],
      "nietoc:ix": [
        "Claire Liu",
        "Jake Caravello",
        "Sadie Zwonitzer",
        "Eric Qian",
        "Boyana Nikolova",
        "Anokhi Shah",
      ],
      "nietoc:usx": [
        "Hudson Turman",
        "Zoey Qin",
        "Rehan Buvvaji",
        "Rohan Saarang",
        "Gary Hao",
        "Simon Forbes",
      ],
    });
  });

  it("rebuilds the reviewed SpeechWire evidence without a diagnostic", () => {
    const input = build2025_26RebuildInput([], REVIEWED_SPEECHWIRE_2025_26);
    const output = rebuildSeason(input);

    expect(output.diagnostics).toEqual([]);
    expect(output.identity.diagnostics).toEqual([]);
    expect(output.awards).toHaveLength(42);
  });
});
