import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { rebuildSeason } from "@points-race/pipeline";

import { buildPublicReconstructionReport } from "./public-report.js";
import { REVIEWED_SPEECHWIRE_2025_26 } from "./speechwire-reviewed.js";
import {
  build2025_26RebuildInput,
  type CompactTabroomArtifact,
} from "./season-2025-26.js";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const compactRoot = resolve(workspaceRoot, "work/reconstruction/compact");
const destination = resolve(
  workspaceRoot,
  "apps/web/src/data/reconstruction/2025-26.json",
);
const names = (await readdir(compactRoot))
  .filter((name) => /^tabroom-\d+\.json$/u.test(name))
  .sort();
const artifacts: CompactTabroomArtifact[] = [];
for (const name of names) {
  artifacts.push(
    JSON.parse(
      await readFile(resolve(compactRoot, name), "utf8"),
    ) as CompactTabroomArtifact,
  );
}
const input = build2025_26RebuildInput(artifacts, REVIEWED_SPEECHWIRE_2025_26);
const output = rebuildSeason(input);
const report = buildPublicReconstructionReport(input, output);

if (report.diagnostics.identity !== 0 || report.diagnostics.rebuild !== 0) {
  throw new Error("The public reconstruction report contained diagnostics.");
}
if (
  report.completeness.verifiedResultSources !== 18 ||
  report.completeness.notHeld !== 1 ||
  report.completeness.withheld !== 1
) {
  throw new Error("The public reconstruction source audit was incomplete.");
}

await mkdir(resolve(destination, ".."), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${report.standingsVersion} ${report.standings.length} standings ${destination}\n`,
);
