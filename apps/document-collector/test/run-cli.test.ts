import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const builtRunner = fileURLToPath(new URL("../dist/run.js", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "points-race-run-cli-"));
const invalidManifests = join(scratch, "invalid-manifests");
const emptyManifests = join(scratch, "empty-manifests");
mkdirSync(invalidManifests);
mkdirSync(emptyManifests);
writeFileSync(
  join(invalidManifests, "invalid.json"),
  "private-manifest-marker",
);

const SERVICE_URL = "https://service.example.test";
const SECRET = " test-only-signing-key ";
const NO_NETWORK = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch = async () => { throw new Error("private-network-marker"); };',
)}`;

afterAll(() => {
  unlinkSync(join(invalidManifests, "invalid.json"));
  rmdirSync(invalidManifests);
  rmdirSync(emptyManifests);
  rmdirSync(scratch);
});

function runScheduledCli(input: {
  readonly serviceUrl?: string;
  readonly secret?: string;
  readonly args?: readonly string[];
  readonly manifestDirectory?: string;
  readonly networkScript?: string;
}) {
  const env = { ...process.env };
  delete env.POINTS_RACE_SERVICE_URL;
  delete env.DOCUMENT_INGEST_SECRET;
  delete env.NODE_OPTIONS;
  if (input.serviceUrl !== undefined)
    env.POINTS_RACE_SERVICE_URL = input.serviceUrl;
  if (input.secret !== undefined) env.DOCUMENT_INGEST_SECRET = input.secret;
  env.POINTS_RACE_MANIFEST_DIR = input.manifestDirectory ?? invalidManifests;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      input.networkScript ?? NO_NETWORK,
      builtRunner,
      ...(input.args ?? []),
    ],
    { env, encoding: "utf8", timeout: 10_000 },
  );
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe.each([[], ["--check-config"]])(
  "built scheduled runner with %j",
  (...args) => {
    it.each([
      { secret: SECRET, key: "POINTS_RACE_SERVICE_URL" },
      { serviceUrl: "", secret: SECRET, key: "POINTS_RACE_SERVICE_URL" },
      { serviceUrl: " \t ", secret: SECRET, key: "POINTS_RACE_SERVICE_URL" },
      { serviceUrl: SERVICE_URL, key: "DOCUMENT_INGEST_SECRET" },
      { serviceUrl: SERVICE_URL, secret: "", key: "DOCUMENT_INGEST_SECRET" },
      {
        serviceUrl: SERVICE_URL,
        secret: " \t ",
        key: "DOCUMENT_INGEST_SECRET",
      },
    ])("reports missing $key before loading manifests", (configuration) => {
      const result = runScheduledCli({ ...configuration, args });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("DOCUMENT_COLLECTOR_CONFIG_MISSING");
      expect(result.stderr).toContain(configuration.key);
      expect(result.stderr).not.toMatch(
        /private-|test-only-signing-key|\n\s+at /,
      );
    });

    it("reports both missing keys even when no documents are configured", () => {
      const result = runScheduledCli({
        args,
        manifestDirectory: emptyManifests,
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("DOCUMENT_COLLECTOR_CONFIG_MISSING");
      expect(result.stderr).toContain("POINTS_RACE_SERVICE_URL");
      expect(result.stderr).toContain("DOCUMENT_INGEST_SECRET");
    });
  },
);

describe("built scheduled runner configuration checks", () => {
  it("runs the built CLI across the current and previous seasons", () => {
    const networkScript = `data:text/javascript,${encodeURIComponent(`
      const NativeDate = Date;
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : ['2027-08-01T09:47:00.000Z'])); }
        static now() { return NativeDate.parse('2027-08-01T09:47:00.000Z'); }
      };
      globalThis.fetch = async input => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.pathname === '/v1/seasons') return Response.json({currentSeasonId:'2027-28', seasons:[{seasonId:'2027-28'},{seasonId:'2026-27'}]});
        const match = /^\\/v1\\/seasons\\/(2027-28|2026-27)\\/tournaments$/.exec(url.pathname);
        if (match) return Response.json({seasonId:match[1],version:'a'.repeat(64),tournaments:[]});
        throw new Error('Unexpected network request');
      };
    `)}`;
    const result = runScheduledCli({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      manifestDirectory: emptyManifests,
      networkScript,
    });
    expect(result).toEqual({
      status: 0,
      stderr: "",
      stdout:
        "DOCUMENT_COLLECTOR_OK season=2027-28 considered=0 submitted=0 duplicates=0 seasons=2027-28,2026-27\n",
    });
  });

  it.each([
    "private-invalid-url",
    "http://service.example.test",
    "https://user:private-password@service.example.test",
    "https://service.example.test:8443",
    "https://service.example.test?token=private-query",
    "https://service.example.test#private-fragment",
    "https://service.example.test/private-path",
  ])("rejects an invalid service URL without echoing it", (serviceUrl) => {
    const result = runScheduledCli({
      serviceUrl,
      secret: SECRET,
      args: ["--check-config"],
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("DOCUMENT_COLLECTOR_CONFIG_INVALID");
    expect(result.stderr).toContain("POINTS_RACE_SERVICE_URL");
    expect(result.stderr).not.toMatch(
      /private-|example\.test|test-only-signing-key|\n\s+at /,
    );
  });

  it("checks valid settings without reading manifests or making requests", () => {
    const result = runScheduledCli({
      serviceUrl: SERVICE_URL,
      secret: SECRET,
      args: ["--check-config"],
    });

    expect(result).toEqual({
      status: 0,
      stdout: "DOCUMENT_COLLECTOR_CONFIG_OK\n",
      stderr: "",
    });
  });

  it.each(["manifest", "network"])(
    "keeps arbitrary %s errors generic",
    (failure) => {
      const result = runScheduledCli({
        serviceUrl: SERVICE_URL,
        secret: SECRET,
        manifestDirectory:
          failure === "manifest" ? invalidManifests : emptyManifests,
      });

      expect(result).toEqual({
        status: 1,
        stdout: "",
        stderr: "DOCUMENT_COLLECTOR_FAILED\n",
      });
    },
  );
});
