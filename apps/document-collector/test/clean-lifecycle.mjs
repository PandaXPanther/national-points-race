/* global process */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const policyDist = resolve(workspaceRoot, "packages/policy/dist");
const pipelineDist = resolve(workspaceRoot, "packages/pipeline/dist");
const collectorDist = resolve(workspaceRoot, "apps/document-collector/dist");
const pnpmCli = process.env.npm_execpath;

if (pnpmCli === undefined) {
  throw new Error("pnpm lifecycle verification requires npm_execpath");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.stdout !== undefined) process.stdout.write(result.stdout);
  if (result.stderr !== undefined) process.stderr.write(result.stderr);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${String(result.status)}`,
    );
  }
  return result.stdout;
}

function runPnpm(args) {
  return run(process.execPath, [pnpmCli, ...args]);
}

function clean(packageName, path) {
  run("git", ["check-ignore", "--quiet", "--", path]);
  runPnpm(["--filter", packageName, "run", "clean"]);
  if (existsSync(path)) throw new Error(`Clean did not remove ${path}`);
}

function assertBuilt() {
  for (const path of [
    resolve(policyDist, "index.js"),
    resolve(pipelineDist, "index.js"),
    resolve(collectorDist, "index.js"),
    resolve(collectorDist, "cli.js"),
    resolve(collectorDist, "run.js"),
  ]) {
    if (!existsSync(path)) throw new Error(`Lifecycle did not build ${path}`);
  }
}

const trackedBefore = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
for (const [name, path] of [
  ["@points-race/document-collector", collectorDist],
  ["@points-race/pipeline", pipelineDist],
  ["@points-race/policy", policyDist],
]) {
  clean(name, path);
}
runPnpm([
  "--filter",
  "@points-race/document-collector",
  "run",
  "test",
  "--",
  "pdf.test.ts",
]);
assertBuilt();

for (const [name, path] of [
  ["@points-race/document-collector", collectorDist],
  ["@points-race/pipeline", pipelineDist],
  ["@points-race/policy", policyDist],
]) {
  clean(name, path);
}
runPnpm(["--filter", "@points-race/document-collector", "run", "typecheck"]);
assertBuilt();

const trackedAfter = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
if (trackedAfter !== trackedBefore) {
  throw new Error("Clean lifecycle verification changed tracked files");
}
