import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return nested.flat();
}

describe("public copy rules", () => {
  it("contains no em dashes in source-controlled public content", async () => {
    const files = (await sourceFiles(sourceRoot)).filter((path) =>
      /\.(?:astro|css|json|ts)$/u.test(path),
    );
    const contents = await Promise.all(
      files.map(async (path) => ({
        path,
        value: await readFile(path, "utf8"),
      })),
    );
    expect(contents.filter(({ value }) => value.includes("\u2014"))).toEqual(
      [],
    );
  });

  it("publishes the correction route throughout the reference experience", async () => {
    const callout = await readFile(
      `${sourceRoot}components/DiscordCallout.astro`,
      "utf8",
    );
    expect(callout).toContain("https://discord.gg/8RFTvCWPPv");
    expect(callout).toContain("@PandaXPanther");
  });
});
