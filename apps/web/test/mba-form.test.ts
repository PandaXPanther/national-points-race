import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

describe("public MBA results form", () => {
  it("requires submitter identity, one evidence source, six placements, and attestation", async () => {
    const form = await readFile(
      `${sourceRoot}components/MbaSubmissionForm.astro`,
      "utf8",
    );
    expect(form).toContain('name="submitterName"');
    expect(form).toContain('name="nsdaNumber"');
    expect(form).toContain('name="evidenceFile"');
    expect(form).toContain('name="evidenceUrl"');
    expect(form).toContain(
      'const placeLabels = ["1st", "2nd", "3rd", "4th", "5th", "6th"]',
    );
    expect(form).toContain("name={`placement${index + 1}`}");
    expect(form).toContain("{label} place");
    expect(form).toContain('name="attestation"');
    expect(form).toContain("cf-turnstile");
    expect(form).toContain("exactly once");
  });

  it("clears the NSDA number after submit and renders the one-shot closed status", async () => {
    const form = await readFile(
      `${sourceRoot}components/MbaSubmissionForm.astro`,
      "utf8",
    );
    expect(form).toContain('nsdaInput.value = ""');
    expect(form).toContain(
      "Only one accepted submission is allowed per season",
    );
    expect(form).toContain("submission-status");
    expect(form).toContain("rebuildState");
    expect(form).not.toContain("localStorage");
    expect(form).not.toContain("sessionStorage");
  });

  it("provides the Discord correction route after acceptance", async () => {
    const form = await readFile(
      `${sourceRoot}components/MbaSubmissionForm.astro`,
      "utf8",
    );
    expect(form).toContain("https://discord.gg/8RFTvCWPPv");
    expect(form).toContain("@PandaXPanther");
  });
});
