import {
  NormalizedResultSetSchema,
  SourceDescriptorSchema,
  SourceFetchError,
  assertAllowedSource,
  type NormalizedResultSet,
  type SourcePerson,
} from "@points-race/pipeline";
import type { Hono } from "hono";
import { z } from "zod";

import { verifyDocumentSignature, type ServiceBindings } from "../auth/hmac.js";
import { enqueueJob } from "../jobs/enqueue.js";
import { createEditionRepository } from "../storage/editions.js";
import { createResultRepository } from "../storage/results.js";
import { createSnapshotRepository } from "../storage/snapshots.js";
import { documentContentHash } from "../storage/document-receipts.js";
import { Sha256Schema, UtcIsoStringSchema } from "../storage/types.js";

const MAX_PACKET_BYTES = 25 * 1_024 * 1_024;
const PACKET_MEDIA_TYPE = "application/json";

const DocumentSourceSchema = z
  .object({
    descriptor: SourceDescriptorSchema,
    url: z.string().url(),
    sha256: Sha256Schema,
    mediaType: z.string().min(1),
    retrievedAt: UtcIsoStringSchema,
    parserVersion: z.string().min(1),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.descriptor.permission !== "official-public-document") {
      context.addIssue({
        code: "custom",
        path: ["descriptor", "permission"],
        message: "Only official public documents may be ingested.",
      });
    }
    if (!source.descriptor.allowedMediaTypes.includes(source.mediaType)) {
      context.addIssue({
        code: "custom",
        path: ["mediaType"],
        message: "Source media type is not permitted by its descriptor.",
      });
    }
  })
  .readonly();

const DocumentIngestPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    editionId: z.string().min(1),
    source: DocumentSourceSchema,
    resultSets: z.array(NormalizedResultSetSchema).min(1).readonly(),
  })
  .strict()
  .superRefine((packet, context) => {
    const expectedSnapshotId = `sha256:${packet.source.sha256}`;
    packet.resultSets.forEach((resultSet, index) => {
      if (resultSet.editionId !== packet.editionId) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "editionId"],
          message: "Result set belongs to another edition.",
        });
      }
      if (resultSet.sourceSnapshotId !== expectedSnapshotId) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "sourceSnapshotId"],
          message: "Result set is not bound to the declared source hash.",
        });
      }
      if (!resultSet.explicitFinal) {
        context.addIssue({
          code: "custom",
          path: ["resultSets", index, "explicitFinal"],
          message: "Only explicitly final official results may be ingested.",
        });
      }
    });
  })
  .readonly();

function json(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function sourcePeopleFrom(
  resultSets: readonly NormalizedResultSet[],
): readonly SourcePerson[] {
  const people = new Map<string, SourcePerson>();
  for (const resultSet of resultSets) {
    for (const result of resultSet.results) {
      const person: SourcePerson = {
        editionId: resultSet.editionId,
        eventId: resultSet.event.id,
        division: result.division,
        sourceSnapshotId: resultSet.sourceSnapshotId,
        provider: "document",
        sourcePersonId: result.sourcePersonId,
        sourceEntryId: result.sourceEntryId,
        publishedName: result.publishedName,
        publishedSchool: result.publishedSchool,
        simultaneousEntryContext: null,
      };
      people.set(
        JSON.stringify([
          person.editionId,
          person.eventId,
          person.division,
          person.sourceEntryId,
        ]),
        person,
      );
    }
  }
  return [...people.values()].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

function rewriteSnapshot(
  resultSets: readonly NormalizedResultSet[],
  snapshotId: string,
): readonly NormalizedResultSet[] {
  return resultSets.map((resultSet) =>
    NormalizedResultSetSchema.parse({
      ...resultSet,
      sourceSnapshotId: snapshotId,
      parserDiagnostics: resultSet.parserDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        sourceSnapshotId: snapshotId,
      })),
    }),
  );
}

function safeJson(bytes: Uint8Array): unknown {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
  );
}

export function registerIngestRoute(
  app: Hono<{ Bindings: ServiceBindings }>,
): void {
  app.post("/internal/document-ingest", async (context) => {
    const declaredLength = context.req.header("content-length");
    if (
      declaredLength !== undefined &&
      /^\d+$/u.test(declaredLength) &&
      BigInt(declaredLength) > BigInt(MAX_PACKET_BYTES)
    ) {
      return json(
        { error: "payload_too_large", diagnosticCode: "INGEST_TOO_LARGE" },
        413,
      );
    }
    const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
    if (bytes.byteLength > MAX_PACKET_BYTES) {
      return json(
        { error: "payload_too_large", diagnosticCode: "INGEST_TOO_LARGE" },
        413,
      );
    }
    const auth = verifyDocumentSignature(
      context.req.raw,
      bytes,
      context.env.DOCUMENT_INGEST_SECRET,
    );
    if (!auth.ok) {
      return json(
        {
          error:
            auth.code === "AUTH_CONFIGURATION_MISSING"
              ? "service_unavailable"
              : "unauthorized",
          diagnosticCode: auth.code,
        },
        auth.code === "AUTH_CONFIGURATION_MISSING" ? 503 : 401,
      );
    }

    let packet: z.infer<typeof DocumentIngestPacketSchema>;
    try {
      packet = DocumentIngestPacketSchema.parse(safeJson(bytes));
      assertAllowedSource(new URL(packet.source.url), packet.source.descriptor);
    } catch (error) {
      const code =
        error instanceof SourceFetchError
          ? "INGEST_SOURCE_NOT_ALLOWED"
          : "INGEST_PACKET_INVALID";
      return json({ error: "invalid_request", diagnosticCode: code }, 400);
    }

    const editions = createEditionRepository(context.env.DB);
    const edition = await editions.get(packet.editionId);
    if (edition === null) {
      return json(
        { error: "not_found", diagnosticCode: "INGEST_EDITION_NOT_FOUND" },
        404,
      );
    }
    if (
      packet.resultSets.some(
        (resultSet) => resultSet.lineageId !== edition.lineageId,
      )
    ) {
      return json(
        {
          error: "invalid_request",
          diagnosticCode: "INGEST_LINEAGE_CONFLICT",
        },
        400,
      );
    }

    const descriptorId = `signed-packet:${packet.source.descriptor.id}`;
    const contentHash = await documentContentHash(packet);
    const receipt = await context.env.DB.prepare(
      "SELECT r.content_sha256, s.sha256 FROM document_ingest_receipts r JOIN source_snapshots s ON s.id = r.snapshot_id WHERE r.edition_id = ?1 AND r.descriptor_id = ?2 AND r.source_url = ?3",
    )
      .bind(packet.editionId, descriptorId, packet.source.url)
      .first<{ content_sha256: string; sha256: string }>();
    if (receipt?.content_sha256 === contentHash) {
      return json(
        {
          accepted: true,
          duplicate: true,
          editionId: packet.editionId,
          snapshotSha256: receipt.sha256,
        },
        200,
      );
    }
    const existing = await context.env.DB.prepare(
      "SELECT id FROM source_snapshots WHERE edition_id = ?1 AND descriptor_id = ?2 AND sha256 = ?3 LIMIT 1",
    )
      .bind(packet.editionId, descriptorId, auth.contentSha256)
      .first<{ id: string }>();
    const snapshot = await createSnapshotRepository(
      context.env.DB,
      context.env.RAW_SNAPSHOTS,
    ).persist({
      editionId: packet.editionId,
      descriptor: {
        id: descriptorId,
        sourceClass: packet.source.descriptor.sourceClass,
        allowlistedHostnames: packet.source.descriptor.allowlistedHostnames,
        allowedMediaTypes: [PACKET_MEDIA_TYPE],
        permission: "official-public-document",
      },
      url: packet.source.url,
      retrievedAt: packet.source.retrievedAt,
      mediaType: PACKET_MEDIA_TYPE,
      parserVersion: `${packet.source.parserVersion}+signed-packet-v1`,
      permission: "official-public-document",
      bytes,
      sha256: auth.contentSha256,
    });
    const resultSets = rewriteSnapshot(packet.resultSets, snapshot.id);
    await createResultRepository(context.env.DB).persist({
      id: `evidence:${snapshot.id}`,
      editionId: packet.editionId,
      sourceSnapshotId: snapshot.id,
      resultSets,
      sourcePeople: sourcePeopleFrom(resultSets),
      explicitIdentityEdges: [],
    });
    const evidence = await context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM normalized_evidence_groups WHERE edition_id = ?1",
    )
      .bind(packet.editionId)
      .first<{ count: number }>();
    await editions.updateDiscovery({
      id: edition.id,
      startAt: edition.startAt,
      endAt: edition.endAt,
      status:
        (evidence?.count ?? 0) > 1 ||
        packet.resultSets.some(({ correction }) => correction)
          ? "corrected"
          : "final",
      discoveredFrom: edition.discoveredFrom,
    });
    await enqueueJob(
      { db: context.env.DB, queue: context.env.JOBS },
      {
        type: "rebuild-season",
        naturalKey: `${edition.seasonId}:rebuild:${snapshot.sha256}`,
        seasonId: edition.seasonId,
        scheduledFor: snapshot.retrievedAt,
        reason: "EVIDENCE_CHANGED",
        dispatchedAt: snapshot.retrievedAt,
      },
    );
    // Record completion only after evidence and its durable rebuild job exist.
    // A failed/partial ingest can therefore be retried normally.
    await context.env.DB.prepare(
      "INSERT INTO document_ingest_receipts (edition_id, descriptor_id, source_url, content_sha256, snapshot_id, observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (edition_id, descriptor_id, source_url) DO UPDATE SET content_sha256 = excluded.content_sha256, snapshot_id = excluded.snapshot_id, observed_at = excluded.observed_at WHERE julianday(excluded.observed_at) >= julianday(document_ingest_receipts.observed_at)",
    )
      .bind(
        packet.editionId,
        descriptorId,
        packet.source.url,
        contentHash,
        snapshot.id,
        snapshot.retrievedAt,
      )
      .run();
    return json(
      {
        accepted: true,
        duplicate: existing !== null,
        editionId: packet.editionId,
        snapshotSha256: snapshot.sha256,
      },
      existing === null ? 202 : 200,
    );
  });
}
