import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NormalizedResultSetSchema } from "@points-race/pipeline";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
const fixtureRoot = resolve(appRoot, "test/fixtures");
const packageJson = JSON.parse(
  readFileSync(resolve(appRoot, "package.json"), "utf8"),
) as { bin?: Readonly<Record<string, string>> };
const declaredBin = packageJson.bin?.["points-race-collect"];
const builtCli =
  declaredBin === undefined
    ? resolve(appRoot, "dist/cli.js")
    : resolve(appRoot, declaredBin);
let scratch = "";

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [builtCli, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function copyFixtureSet(): string {
  const target = resolve(scratch, "fixture");
  mkdirSync(target);
  copyFileSync(
    resolve(fixtureRoot, "manifest.json"),
    resolve(target, "manifest.json"),
  );
  copyFileSync(
    resolve(fixtureRoot, "results.pdf"),
    resolve(target, "results.pdf"),
  );
  return target;
}

function readManifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "points-race-document-collector-"));
});

afterEach(() => {
  if (scratch !== "") rmSync(scratch, { force: true, recursive: true });
});

describe("built points-race-collect CLI", () => {
  it("resolves the declared bin to the built ESM CLI", () => {
    expect(declaredBin).toBe("./dist/cli.js");
    expect(existsSync(builtCli)).toBe(true);
  });

  it("writes deterministic normalized UTF-8 JSON with a trailing newline", () => {
    const fixture = copyFixtureSet();
    const output = resolve(scratch, "nested/output.json");

    const result = runCli([
      "--manifest",
      resolve(fixture, "manifest.json"),
      "--output",
      output,
    ]);

    expect(result).toEqual({ status: 0, stdout: "", stderr: "" });
    const text = readFileSync(output, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.stringify(JSON.parse(text), null, 2) + "\n").toBe(text);
    expect(
      NormalizedResultSetSchema.array().parse(JSON.parse(text)),
    ).toHaveLength(1);
    expect(text).not.toMatch(
      /@|password|token|phone|contact|ReportLab|CreationDate/i,
    );
    expect(readdirSync(dirname(output))).toEqual([basename(output)]);
  });

  it("exits 2 for missing manifests and sources", () => {
    const missingManifest = runCli([
      "--manifest",
      resolve(scratch, "missing.json"),
      "--output",
      resolve(scratch, "output.json"),
    ]);
    expect(missingManifest.status).toBe(2);
    expect(missingManifest.stderr).toMatch(/^MANIFEST_FILE_NOT_FOUND: /);
    expect(missingManifest.stderr).not.toMatch(/\n\s+at |ENOENT|missing\.json/);

    const fixture = copyFixtureSet();
    rmSync(resolve(fixture, "results.pdf"));
    const missingSource = runCli([
      "--manifest",
      resolve(fixture, "manifest.json"),
      "--output",
      resolve(scratch, "output.json"),
    ]);
    expect(missingSource.status).toBe(2);
    expect(missingSource.stderr).toMatch(/^SOURCE_FILE_NOT_FOUND: /);
    expect(missingSource.stderr).not.toMatch(/\n\s+at |ENOENT|results\.pdf/);
  });

  it("exits 2 for invalid manifests, remote sources, and media/path mismatch", () => {
    const fixture = copyFixtureSet();
    const manifestPath = resolve(fixture, "manifest.json");
    const remote = readManifest(manifestPath);
    remote.sourcePath = "https://example.test/results.pdf";
    writeFileSync(manifestPath, JSON.stringify(remote), "utf8");
    const remoteResult = runCli([
      "--manifest",
      manifestPath,
      "--output",
      resolve(scratch, "output.json"),
    ]);
    expect(remoteResult.status).toBe(2);
    expect(remoteResult.stderr).toMatch(/^MANIFEST_SOURCE_PATH_INVALID: /);

    const mismatch = readManifest(resolve(fixtureRoot, "manifest.json"));
    mismatch.mediaType = "application/json";
    writeFileSync(manifestPath, JSON.stringify(mismatch), "utf8");
    const mismatchResult = runCli([
      "--manifest",
      manifestPath,
      "--output",
      resolve(scratch, "output.json"),
    ]);
    expect(mismatchResult.status).toBe(2);
    expect(mismatchResult.stderr).toMatch(/^SOURCE_MEDIA_PATH_MISMATCH: /);
  });

  it("exits 3 on parser failure without partially replacing existing output", () => {
    const fixture = copyFixtureSet();
    writeFileSync(resolve(fixture, "results.pdf"), "not a PDF", "utf8");
    const output = resolve(scratch, "existing-output.json");
    writeFileSync(output, "preserve-me\n", "utf8");

    const result = runCli([
      "--manifest",
      resolve(fixture, "manifest.json"),
      "--output",
      output,
    ]);

    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/^PDF_MALFORMED: /);
    expect(result.stderr).not.toMatch(/\n\s+at |not a PDF|existing-output/);
    expect(readFileSync(output, "utf8")).toBe("preserve-me\n");
    expect(
      readdirSync(scratch).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("refuses to overwrite the manifest or source", () => {
    const fixture = copyFixtureSet();
    const manifestPath = resolve(fixture, "manifest.json");
    const sourcePath = resolve(fixture, "results.pdf");
    const manifestBefore = readFileSync(manifestPath);
    const sourceBefore = readFileSync(sourcePath);

    for (const output of [manifestPath, sourcePath]) {
      const result = runCli(["--manifest", manifestPath, "--output", output]);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/^OUTPUT_PATH_CONFLICT: /);
    }

    expect(readFileSync(manifestPath)).toEqual(manifestBefore);
    expect(readFileSync(sourcePath)).toEqual(sourceBefore);
  });

  it("exits 2 for incomplete or unexpected CLI arguments", () => {
    for (const args of [
      [],
      ["--manifest", "manifest.json"],
      ["--manifest", "manifest.json", "--output", "out.json", "--remote"],
    ]) {
      const result = runCli(args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/^CLI_ARGUMENT_INVALID: /);
      expect(result.stderr).not.toMatch(/\n\s+at /);
    }
    const remote = runCli([
      "--manifest",
      "https://example.test/manifest.json",
      "--output",
      resolve(scratch, "output.json"),
    ]);
    expect(remote.status).toBe(2);
    expect(remote.stderr).toMatch(/^CLI_ARGUMENT_INVALID: /);
  });
});
