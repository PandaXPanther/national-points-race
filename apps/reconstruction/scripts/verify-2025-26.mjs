import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const artifactPath = fileURLToPath(
  new URL("../../web/src/data/reconstruction/2025-26.json", import.meta.url),
);
const expectedCanonicalSha256 =
  "01e695e4c4cad2f33d0e11518f6c03f6e6ed32f0c1d370284d14a72cfd59b091";

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
  champion?.points !== 619
) {
  throw new Error("The reviewed 2025-26 champion record is not intact.");
}

process.stdout.write(
  `2025-26 artifact verified: ${canonicalSha256}, 100 standings\n`,
);
