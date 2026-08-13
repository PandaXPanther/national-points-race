import { fetchBounded, type SourceDescriptor } from "@points-race/pipeline";
import type { Hono } from "hono";

import type { ServiceBindings } from "../auth/hmac.js";
import { enqueueJob } from "../jobs/enqueue.js";
import {
  MBA_EVIDENCE_MAX_BYTES,
  MBA_EVIDENCE_TYPES,
  MbaEvidenceError,
  extractMbaEvidenceText,
  validateMbaEvidence,
} from "../mba/evidence.js";
import {
  digestNsdaNumber,
  maskNsdaNumber,
  normalizeNsdaNumber,
  normalizeSubmittedName,
} from "../mba/normalize.js";
import { matchMbaCompetitors } from "../mba/validate.js";
import { createEditionRepository } from "../storage/editions.js";
import { createMbaSubmissionRepository } from "../storage/mba-submissions.js";
import { createResultRepository } from "../storage/results.js";
import { createSnapshotRepository } from "../storage/snapshots.js";

const OFFICIAL_EVIDENCE_DESCRIPTOR: SourceDescriptor = Object.freeze({
  id: "mba-official-results-submission-v1",
  sourceClass: "organizer-html-pdf",
  allowlistedHostnames: Object.freeze([
    "montgomerybell.edu",
    "www.montgomerybell.edu",
    "www.tabroom.com",
    "national-points-race.pages.dev",
  ]),
  allowedMediaTypes: Object.freeze([...MBA_EVIDENCE_TYPES]),
  permission: "official-public-document",
});

interface EvidencePacket {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mediaType: string;
  readonly sha256: string;
  readonly kind: "upload" | "official-url";
  readonly publicUrl: string;
  readonly submittedUrl: string | null;
}

export interface MbaRebuildRequest {
  readonly seasonId: string;
  readonly evidenceSha256: string;
  readonly scheduledFor: string;
  readonly reason: "MBA_RESULTS_ACCEPTED";
}

export interface MbaRouteDependencies {
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly verifyTurnstile?: (
    token: string,
    secret: string | undefined,
    remoteIp: string | undefined,
  ) => Promise<boolean>;
  readonly enqueueRebuild?: (
    bindings: ServiceBindings,
    request: MbaRebuildRequest,
  ) => Promise<void>;
}

class MbaRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "MbaRouteError";
  }
}

function json(body: object, status: number, origin?: string): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  if (origin !== undefined) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function defaultVerifyTurnstile(
  token: string,
  secret: string | undefined,
  remoteIp: string | undefined,
): Promise<boolean> {
  if (secret === undefined || secret.length === 0) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp !== undefined) form.set("remoteip", remoteIp);
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as { success?: unknown };
    return body.success === true;
  } catch {
    return false;
  }
}

async function defaultEnqueueRebuild(
  bindings: ServiceBindings,
  request: MbaRebuildRequest,
): Promise<void> {
  await enqueueJob(
    { db: bindings.DB, queue: bindings.JOBS },
    {
      type: "rebuild-season",
      naturalKey: `${request.seasonId}:rebuild:mba:${request.evidenceSha256}`,
      seasonId: request.seasonId,
      scheduledFor: request.scheduledFor,
      dispatchedAt: request.scheduledFor,
      reason: request.reason,
    },
  );
}

function value(form: FormData, key: string): string {
  const observed = form.get(key);
  if (typeof observed !== "string" || observed.trim() === "") {
    throw new MbaRouteError(400, "MBA_FORM_INVALID");
  }
  return observed;
}

function allowedOrigin(
  request: Request,
  bindings: ServiceBindings,
): string | undefined {
  const origin = request.headers.get("origin");
  return origin !== null && origin === bindings.PUBLIC_ORIGIN
    ? origin
    : undefined;
}

async function evidenceFrom(
  form: FormData,
  fetchImpl: typeof fetch | undefined,
  now: () => Date,
): Promise<EvidencePacket> {
  const rawUrl = form.get("evidenceUrl");
  const urlText = typeof rawUrl === "string" ? rawUrl.trim() : "";
  const rawFile = form.get("evidenceFile");
  const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;
  if (urlText.length > 0 === (file !== null))
    throw new MbaRouteError(400, "MBA_EVIDENCE_EXCLUSIVE");

  if (urlText.length > 0) {
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      throw new MbaRouteError(400, "MBA_EVIDENCE_URL_INVALID");
    }
    try {
      const response = await fetchBounded({
        url,
        descriptor: OFFICIAL_EVIDENCE_DESCRIPTOR,
        maxBytes: MBA_EVIDENCE_MAX_BYTES,
        timeoutMs: 30_000,
        acceptedTypes: MBA_EVIDENCE_TYPES,
        ...(fetchImpl === undefined ? {} : { fetchImpl }),
        now,
      });
      const bytes = new Uint8Array(response.body.byteLength);
      bytes.set(response.body);
      return {
        bytes,
        mediaType: response.mediaType,
        sha256: response.sha256,
        kind: "official-url",
        publicUrl: response.finalUrl,
        submittedUrl: response.finalUrl,
      };
    } catch {
      throw new MbaRouteError(422, "MBA_EVIDENCE_FETCH_REJECTED");
    }
  }

  if (
    file === null ||
    !MBA_EVIDENCE_TYPES.includes(
      file.type as (typeof MBA_EVIDENCE_TYPES)[number],
    )
  ) {
    throw new MbaRouteError(415, "MBA_EVIDENCE_TYPE_REJECTED");
  }
  if (file.size > MBA_EVIDENCE_MAX_BYTES)
    throw new MbaRouteError(413, "MBA_EVIDENCE_TOO_LARGE");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await sha256(bytes);
  return {
    bytes,
    mediaType: file.type,
    sha256: digest,
    kind: "upload",
    publicUrl: `https://national-points-race.pages.dev/submitted-evidence/${digest}`,
    submittedUrl: null,
  };
}

async function submissionId(
  seasonId: string,
  submitterDigest: string,
  evidenceSha256: string,
  submittedAt: string,
): Promise<string> {
  return `mba-submission:${await sha256(new TextEncoder().encode(JSON.stringify([seasonId, submitterDigest, evidenceSha256, submittedAt])))}`;
}

export function registerMbaRoutes(
  app: Hono<{ Bindings: ServiceBindings }>,
  dependencies: MbaRouteDependencies = {},
): void {
  const now = dependencies.now ?? (() => new Date());
  const verifyTurnstile =
    dependencies.verifyTurnstile ?? defaultVerifyTurnstile;
  const enqueueRebuild = dependencies.enqueueRebuild ?? defaultEnqueueRebuild;

  app.options(
    "/v1/seasons/:seasonId/tournaments/mba-round-robin/submission",
    (context) => {
      const origin = allowedOrigin(context.req.raw, context.env);
      if (origin === undefined) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    },
  );

  app.get(
    "/v1/seasons/:seasonId/tournaments/mba-round-robin/submission",
    async (context) => {
      const status = await createMbaSubmissionRepository(context.env.DB).status(
        context.req.param("seasonId"),
      );
      return json(status, 200, allowedOrigin(context.req.raw, context.env));
    },
  );

  app.post(
    "/v1/seasons/:seasonId/tournaments/mba-round-robin/submission",
    async (context) => {
      const origin = allowedOrigin(context.req.raw, context.env);
      const seasonId = context.req.param("seasonId");
      const declaredLength = context.req.header("content-length");
      if (
        declaredLength !== undefined &&
        /^\d+$/u.test(declaredLength) &&
        BigInt(declaredLength) > BigInt(MBA_EVIDENCE_MAX_BYTES + 256_000)
      ) {
        return json(
          {
            error: "submission_rejected",
            diagnosticCode: "MBA_EVIDENCE_TOO_LARGE",
          },
          413,
          origin,
        );
      }

      let claimedId: string | null = null;
      const repository = createMbaSubmissionRepository(context.env.DB);
      try {
        if (Number(seasonId.slice(0, 4)) < 2026)
          throw new MbaRouteError(400, "MBA_SEASON_NOT_ELIGIBLE");
        const edition = await createEditionRepository(context.env.DB).get(
          `${seasonId}:mba-round-robin`,
        );
        if (
          edition === null ||
          !["awaiting-results", "provisional", "final", "corrected"].includes(
            edition.status,
          )
        ) {
          throw new MbaRouteError(409, "MBA_SUBMISSION_NOT_OPEN");
        }
        const form = await context.req.formData();
        const submitterName = normalizeSubmittedName(
          value(form, "submitterName"),
        );
        const nsdaNumber = normalizeNsdaNumber(value(form, "nsdaNumber"));
        const token =
          form.get("cf-turnstile-response") ?? form.get("turnstileToken");
        if (
          typeof token !== "string" ||
          token.length === 0 ||
          !(await verifyTurnstile(
            token,
            context.env.TURNSTILE_SECRET_KEY,
            context.req.header("cf-connecting-ip"),
          ))
        ) {
          throw new MbaRouteError(403, "MBA_TURNSTILE_REJECTED");
        }
        if (form.get("attestation") !== "true")
          throw new MbaRouteError(400, "MBA_ATTESTATION_REQUIRED");
        const names = Array.from({ length: 6 }, (_, index) =>
          normalizeSubmittedName(value(form, `placement${index + 1}`)),
        );
        if (new Set(names).size !== 6)
          throw new MbaRouteError(422, "MBA_DUPLICATE_NAME");

        let competitors;
        try {
          competitors = await matchMbaCompetitors(
            context.env.DB,
            seasonId,
            names,
          );
        } catch {
          throw new MbaRouteError(422, "MBA_NAME_NOT_EXACT");
        }
        const evidence = await evidenceFrom(form, dependencies.fetchImpl, now);
        let evidenceText: string;
        try {
          evidenceText = await extractMbaEvidenceText(
            evidence.bytes,
            evidence.mediaType,
          );
          validateMbaEvidence(evidenceText, seasonId, names);
        } catch (error) {
          if (error instanceof MbaEvidenceError)
            throw new MbaRouteError(422, error.code);
          throw error;
        }

        const submittedAt = now().toISOString();
        const secret = context.env.MBA_SUBMITTER_HMAC_KEY;
        if (secret === undefined)
          throw new MbaRouteError(503, "MBA_SUBMISSION_UNAVAILABLE");
        const submitterDigest = await digestNsdaNumber(nsdaNumber, secret);
        claimedId = await submissionId(
          seasonId,
          submitterDigest,
          evidence.sha256,
          submittedAt,
        );
        try {
          await repository.record({
            id: claimedId,
            seasonId,
            editionId: edition.id,
            status: "processing",
            submitterName,
            submitterNsdaDigest: submitterDigest,
            submitterNsdaMask: maskNsdaNumber(nsdaNumber),
            evidenceSha256: evidence.sha256,
            evidenceKind: evidence.kind,
            evidenceUrl: evidence.submittedUrl,
            evidenceSnapshotId: null,
            submittedAt,
            acceptedAt: null,
            rebuildState: "not-queued",
            placements: [],
          });
        } catch {
          claimedId = null;
          throw new MbaRouteError(409, "MBA_SUBMISSION_CLOSED");
        }

        const snapshot = await createSnapshotRepository(
          context.env.DB,
          context.env.RAW_SNAPSHOTS,
        ).persist({
          editionId: edition.id,
          descriptor: OFFICIAL_EVIDENCE_DESCRIPTOR,
          url: evidence.publicUrl,
          retrievedAt: submittedAt,
          mediaType: evidence.mediaType,
          parserVersion: "mba-public-evidence-v1",
          permission: "official-public-document",
          bytes: evidence.bytes,
          sha256: evidence.sha256,
        });
        const sourcePeople = competitors.map((competitor, index) => {
          const sourcePersonId = `mba-submission:${evidence.sha256}:${index + 1}`;
          return {
            editionId: edition.id,
            eventId: "mba-cumulative-results",
            division: "combined" as const,
            sourceSnapshotId: snapshot.id,
            provider: "mba-submission",
            sourcePersonId,
            sourceEntryId: `mba:${index + 1}`,
            publishedName: competitor.displayName,
            publishedSchool: competitor.displaySchool,
            simultaneousEntryContext: null,
          };
        });
        await createResultRepository(context.env.DB).persist({
          id: `mba-evidence:${evidence.sha256}`,
          editionId: edition.id,
          sourceSnapshotId: snapshot.id,
          resultSets: [
            {
              editionId: edition.id,
              lineageId: "mba-round-robin",
              sourceSnapshotId: snapshot.id,
              event: {
                id: "mba-cumulative-results",
                name: "MBA Extemp Round Robin cumulative results",
                division: "combined",
                eligible: true,
              },
              results: competitors.map((competitor, index) => ({
                sourceEntryId: `mba:${index + 1}`,
                sourcePersonId: sourcePeople[index]!.sourcePersonId,
                publishedName: competitor.displayName,
                publishedSchool: competitor.displaySchool,
                division: "combined" as const,
                placement: index + 1,
                furthestStage: "final" as const,
                wonFinalRound: index === 0,
              })),
              publishedAt: submittedAt,
              explicitFinal: true,
              correction: false,
              manifestRuleId: "mba-public-evidence-v1",
              parserDiagnostics: [],
            },
          ],
          sourcePeople,
          explicitIdentityEdges: competitors.map((competitor, index) => ({
            leftSourcePersonKey: sourcePeople[index]!.sourcePersonId,
            rightSourcePersonKey: competitor.verifiedSourcePersonKey,
          })),
        });
        const placements = competitors.map((competitor, index) => ({
          placement: index + 1,
          competitorId: competitor.competitorId,
          submittedName: competitor.displayName,
        }));
        await repository.acceptClaim(
          claimedId,
          submittedAt,
          snapshot.id,
          placements,
        );
        await enqueueRebuild(context.env, {
          seasonId,
          evidenceSha256: evidence.sha256,
          scheduledFor: submittedAt,
          reason: "MBA_RESULTS_ACCEPTED",
        });
        claimedId = null;
        return json(
          {
            accepted: true,
            evidenceSha256: evidence.sha256,
            rebuildState: "queued",
          },
          202,
          origin,
        );
      } catch (error) {
        if (claimedId !== null) await repository.rejectClaim(claimedId);
        if (error instanceof MbaRouteError) {
          return json(
            { error: "submission_rejected", diagnosticCode: error.code },
            error.status,
            origin,
          );
        }
        return json(
          { error: "submission_failed", diagnosticCode: "MBA_INTERNAL_ERROR" },
          500,
          origin,
        );
      }
    },
  );
}
