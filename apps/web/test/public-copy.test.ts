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

  it("publishes restrained maintainer and support links", async () => {
    const layout = await readFile(
      `${sourceRoot}layouts/SiteLayout.astro`,
      "utf8",
    );
    expect(layout).toContain('href="https://sarastotey.com"');
    expect(layout).toContain(
      'href="https://github.com/PandaXPanther/national-points-race"',
    );
    expect(layout).toContain('href="https://buymeacoffee.com/sarast1"');
  });

  it("uses an editorial register instead of generated landing-page patterns", async () => {
    const [styles, home, reconstruction] = await Promise.all([
      readFile(`${sourceRoot}styles/global.css`, "utf8"),
      readFile(`${sourceRoot}pages/index.astro`, "utf8"),
      readFile(`${sourceRoot}pages/2025-26.astro`, "utf8"),
    ]);
    expect(styles).not.toContain("linear-gradient");
    expect(styles).not.toContain("box-shadow");
    expect(styles).not.toContain("border-radius: 999px");
    expect(styles).not.toMatch(
      /\.responsive-table\s+tr\s*\{[^}]*display:\s*block/su,
    );
    expect(home).not.toContain("The race is live again");
    expect(home).not.toContain("Every point should have a receipt");
    expect(reconstruction).not.toContain("The missing season, rebuilt");
  });
});
