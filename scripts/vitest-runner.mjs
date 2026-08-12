/* global console, process */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const vitestEntrypoint = resolve(
  dirname(require.resolve("vitest/package.json")),
  "vitest.mjs",
);

export function normalizeVitestArgs(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

export function runVitest(args) {
  const child = spawn(
    process.execPath,
    [vitestEntrypoint, "run", ...normalizeVitestArgs(args)],
    { stdio: "inherit" },
  );

  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });

  return child;
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runVitest(process.argv.slice(2));
}
