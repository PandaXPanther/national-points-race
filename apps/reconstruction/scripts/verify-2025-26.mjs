import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const artifactPath = fileURLToPath(
  new URL("../../web/src/data/reconstruction/2025-26.json", import.meta.url),
);
const expectedCanonicalSha256 =
  "94bb2535ab829fba1dbf1023121580b7b7200262be41426264f14cc49da6908f";

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const canonicalSha256 = createHash("sha256")
  .update(JSON.stringify(artifact))
  .digest("hex");

if (canonicalSha256 !== expectedCanonicalSha256) {
  throw new Error(
    "The published 2025-26 artifact does not match its reviewed digest.",
  );
}
if (artifact.seasonId !== "2025-26" || artifact.standings?.length !== 100) {
  throw new Error(
    "The published 2025-26 artifact must contain exactly 100 standings.",
  );
}

const champion = artifact.standings[0];
if (
  champion?.rank !== 1 ||
  champion?.name !== "Daphne Kalir-Starr" ||
  champion?.points !== 769
) {
  throw new Error("The reviewed 2025-26 champion record is not intact.");
}

if (
  artifact.completeness?.verifiedResultSources !== 19 ||
  artifact.completeness?.notHeld !== 1 ||
  artifact.completeness?.withheld !== 0
) {
  throw new Error("The reviewed 2025-26 source audit is not complete.");
}

const mba = artifact.tournaments?.find(
  (tournament) => tournament.lineageId === "mba-round-robin",
);
if (
  mba?.status !== "final" ||
  mba?.resultCount !== 6 ||
  mba?.awardCount !== 6 ||
  mba?.source?.sha256 !==
    "b293c39e868455d2ea75214575e15e0df1e1d573161422ff0f30fd403da54cc3"
) {
  throw new Error("The reviewed 2025-26 MBA result record is not intact.");
}

process.stdout.write(
  `2025-26 artifact verified: ${canonicalSha256}, 100 standings\n`,
);
