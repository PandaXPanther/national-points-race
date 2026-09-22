import { SourceFetchError } from "@points-race/pipeline";
import { describe, expect, it } from "vitest";

import {
  CollectorRunError,
  collectorFailure,
  failureReport,
  failureSummary,
} from "../src/diagnostics.js";
import { RequestFailureError } from "../src/retry.js";

describe("safe collector diagnostics", () => {
  it("keeps the bounded source timeout distinct from caller cancellation", () => {
    const failure = collectorFailure(
      new SourceFetchError(
        "SOURCE_TIMEOUT",
        "private-timeout",
        new RequestFailureError("REQUEST_CANCELLED", 2),
      ),
      { stage: "source-download", collector: "tabroom" },
    );
    expect(failure.code).toBe("SOURCE_TIMEOUT");
  });

  it("retains HTTP failure details through bounded-fetch wrapping without a raw cause", () => {
    const failure = collectorFailure(
      new SourceFetchError(
        "SOURCE_READ_FAILED",
        "private-provider-text",
        new RequestFailureError("HTTP_TRANSIENT_EXHAUSTED", 3, 503),
      ),
      {
        stage: "source-download",
        collector: "tabroom",
        seasonId: "2026-27",
        editionId: "2026-27:uk-season-opener",
      },
    );
    const error = new CollectorRunError([failure], {
      considered: 2,
      submitted: 1,
      duplicates: 0,
    });
    expect(failureReport(error)).toMatchObject({
      failed: 1,
      considered: 2,
      submitted: 1,
      failures: [
        {
          code: "HTTP_TRANSIENT_EXHAUSTED",
          stage: "source-download",
          seasonId: "2026-27",
          editionId: "2026-27:uk-season-opener",
          status: 503,
          attempts: 3,
        },
      ],
    });
    expect(failureSummary(error)).toContain("2026-27:uk-season-opener");
    expect(JSON.stringify(error)).not.toContain("private-provider-text");
  });

  it("never prints arbitrary errors, causes, provider identifiers, or workflow markup", () => {
    const failure = collectorFailure(
      new Error("secret-signing-key", { cause: "private-token" }),
      {
        stage: "parse",
        collector: "document",
        seasonId: "::error::private-season",
        editionId: "2026-27:private-secret",
      },
    );
    const error = new CollectorRunError([failure]);
    const output =
      JSON.stringify(failureReport(error)) +
      failureSummary(error) +
      error.message;
    expect(output).toContain("PARSE_FAILED");
    expect(output).not.toMatch(/secret|private|::error::|\n\s+at /);
    expect(failure).not.toHaveProperty("editionId");
    expect(failure).not.toHaveProperty("seasonId");
  });
});
