import type { RoundStage } from "./types.js";

const aliases: Readonly<Record<string, RoundStage>> = {
  octa: "octafinal",
  octas: "octafinal",
  octafinal: "octafinal",
  octafinals: "octafinal",
  octofinal: "octafinal",
  octofinals: "octafinal",
  roundof16: "octafinal",
  top16: "octafinal",
  quarterfinal: "quarterfinal",
  quarterfinals: "quarterfinal",
  quarters: "quarterfinal",
  roundof8: "quarterfinal",
  top8: "quarterfinal",
  semifinal: "semifinal",
  semifinals: "semifinal",
  semi: "semifinal",
  semis: "semifinal",
  roundof4: "semifinal",
  top4: "semifinal",
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
  return aliases[normalize(label)] ?? null;
}
