/* global process */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
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

const trackedBefore = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
run("git", ["check-ignore", "--quiet", "--", pipelineDist]);
runPnpm(["--filter", "@points-race/pipeline", "run", "clean"]);
if (existsSync(pipelineDist)) {
  throw new Error(`Clean did not remove ${pipelineDist}`);
}

runPnpm([
  "--filter",
  "@points-race/service",
  "run",
  "test",
  "--",
  "storage.test.ts",
]);
if (!existsSync(resolve(pipelineDist, "index.js"))) {
  throw new Error("Service test lifecycle did not rebuild pipeline/dist");
}

const trackedAfter = run("git", [
  "status",
  "--porcelain",
  "--untracked-files=no",
]);
if (trackedAfter !== trackedBefore) {
  throw new Error("Clean lifecycle verification changed tracked files");
}
