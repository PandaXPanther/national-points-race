/* global process */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pipelineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(pipelineRoot, "../..");
const policyDist = resolve(workspaceRoot, "packages/policy/dist");
const pipelineDist = resolve(workspaceRoot, "packages/pipeline/dist");
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

  if (result.error !== undefined) {
    throw result.error;
  }

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

function cleanGeneratedDist(packageName, expectedDist) {
  run("git", ["check-ignore", "--quiet", "--", expectedDist]);
  runPnpm(["--filter", packageName, "run", "clean"]);

  if (existsSync(expectedDist)) {
    throw new Error(`Clean did not remove ${expectedDist}`);
  }
}

const trackedStatusBefore = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);

cleanGeneratedDist("@points-race/pipeline", pipelineDist);
cleanGeneratedDist("@points-race/policy", policyDist);
runPnpm([
  "--filter",
  "@points-race/pipeline",
  "run",
  "test",
  "--",
  "contracts.test.ts",
]);

if (!existsSync(resolve(policyDist, "index.js"))) {
  throw new Error("Filtered pipeline test did not rebuild policy dist");
}
if (!existsSync(resolve(pipelineDist, "index.js"))) {
  throw new Error("Filtered pipeline test did not rebuild pipeline dist");
}

cleanGeneratedDist("@points-race/pipeline", pipelineDist);
cleanGeneratedDist("@points-race/policy", policyDist);
runPnpm(["--filter", "@points-race/pipeline", "run", "typecheck"]);

if (!existsSync(resolve(policyDist, "index.js"))) {
  throw new Error("Filtered pipeline typecheck did not rebuild policy dist");
}
if (!existsSync(resolve(pipelineDist, "index.js"))) {
  throw new Error("Filtered pipeline typecheck did not rebuild pipeline dist");
}

const trackedStatusAfter = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);

if (trackedStatusAfter !== trackedStatusBefore) {
  throw new Error("Clean lifecycle verification changed tracked files");
}
