import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const astroOutput = join(appRoot, "dist");
const pagesOutput = join(appRoot, "dist-pages");
const workerOutput = join(pagesOutput, "_worker.js");
const astroDeployRedirect = join(appRoot, ".wrangler", "deploy");

rmSync(pagesOutput, { force: true, recursive: true });
rmSync(astroDeployRedirect, { force: true, recursive: true });
mkdirSync(pagesOutput, { recursive: true });
cpSync(join(astroOutput, "client"), pagesOutput, { recursive: true });
cpSync(join(astroOutput, "server"), workerOutput, { recursive: true });

const workerEntry = join(workerOutput, "entry.mjs");
if (!existsSync(workerEntry)) {
  throw new Error("The Astro Cloudflare Worker entry is missing.");
}
renameSync(workerEntry, join(workerOutput, "index.js"));
rmSync(join(workerOutput, "wrangler.json"), { force: true });
