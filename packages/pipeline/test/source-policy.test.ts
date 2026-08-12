import { describe, expect, it } from "vitest";
import { assertAllowedSource, type SourceDescriptor } from "../src/index.js";

const tabroomDescriptor: SourceDescriptor = {
  id: "tabroom-public-export",
  sourceClass: "structured-official-export",
  allowlistedHostnames: ["www.tabroom.com"],
  allowedMediaTypes: ["application/json"],
  permission: "official-public-export",
};

describe("assertAllowedSource", () => {
  it("permits an exact HTTPS allowlisted hostname on the default port", () => {
    expect(() =>
      assertAllowedSource(
        new URL("https://WWW.TABROOM.COM/api/download_data.mhtml"),
        tabroomDescriptor,
      ),
    ).not.toThrow();
  });

  it.each([
    "http://www.tabroom.com/x",
    "https://127.0.0.1/x",
    "https://evil.example/x",
    "https://www.tabroom.com.evil.example/x",
    "https://evilwww.tabroom.com/x",
    "https://www.tabroom.com:8443/x",
    "https://user@www.tabroom.com/x",
    "https://user:password@www.tabroom.com/x",
  ])("rejects disallowed source %s", (value) => {
    try {
      assertAllowedSource(new URL(value), tabroomDescriptor);
      throw new Error("expected source policy rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "SOURCE_POLICY_REJECTED" });
    }
  });
});
