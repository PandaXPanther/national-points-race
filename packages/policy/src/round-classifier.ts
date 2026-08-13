import type { RoundStage } from "./types.js";

const aliases: Readonly<Record<string, RoundStage>> = {
  of: "octafinal",
  octo: "octafinal",
  octa: "octafinal",
  octas: "octafinal",
  octafinal: "octafinal",
  octafinals: "octafinal",
  octofinal: "octafinal",
  octofinals: "octafinal",
  roundof16: "octafinal",
  top16: "octafinal",
  qf: "quarterfinal",
  qrt: "quarterfinal",
  qrts: "quarterfinal",
  qtr: "quarterfinal",
  qtrs: "quarterfinal",
  quarter: "quarterfinal",
  quarterfinal: "quarterfinal",
  quarterfinals: "quarterfinal",
  quarters: "quarterfinal",
  roundof8: "quarterfinal",
  top8: "quarterfinal",
  sf: "semifinal",
  sem: "semifinal",
  sems: "semifinal",
  semifinal: "semifinal",
  semifinals: "semifinal",
  semi: "semifinal",
  semis: "semifinal",
  roundof4: "semifinal",
  roundbeforefinal: "semifinal",
  top4: "semifinal",
  michelecoodytutorial: "semifinal",
  lannynaegelintutorial: "quarterfinal",
  f: "final",
  exhibition: "final",
  final: "final",
  finals: "final",
  finalround: "final",
  championshipfinal: "final",
  jamescopelandexhibitionround: "final",
};

function normalize(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function classifyRoundLabel(label: string): RoundStage | null {
  const normalized = normalize(label);
  return (
    aliases[normalized] ?? aliases[normalized.replace(/\d+$/u, "")] ?? null
  );
}
