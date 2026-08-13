import {
  MbaSubmissionRecordSchema,
  MbaPlacementSchema,
  PublicMbaStatusSchema,
  type MbaSubmissionRecord,
  type PublicMbaStatus,
} from "../mba/types.js";

interface SubmissionRow {
  id: string;
  submitter_name: string;
  submitter_nsda_mask: string;
  evidence_sha256: string;
  evidence_kind: "upload" | "official-url";
  evidence_url: string | null;
  accepted_at: string;
  rebuild_state: "queued" | "published" | "failed";
}

interface PlacementRow {
  placement: number;
  submitted_name: string;
}

export interface MbaSubmissionRepository {
  record(input: MbaSubmissionRecord): Promise<MbaSubmissionRecord>;
  acceptClaim(
    id: string,
    acceptedAt: string,
    evidenceSnapshotId: string,
    placements: MbaSubmissionRecord["placements"],
  ): Promise<void>;
  rejectClaim(id: string): Promise<void>;
  status(seasonId: string): Promise<PublicMbaStatus>;
}

export function createMbaSubmissionRepository(
  db: D1Database,
): MbaSubmissionRepository {
  return {
    async record(rawInput) {
      const input = MbaSubmissionRecordSchema.parse(rawInput);
      const statements = [
        db
          .prepare(
            "INSERT INTO mba_result_submissions (id, season_id, edition_id, status, submitter_name, submitter_nsda_digest, submitter_nsda_mask, evidence_sha256, evidence_kind, evidence_url, evidence_snapshot_id, submitted_at, accepted_at, rebuild_state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
          )
          .bind(
            input.id,
            input.seasonId,
            input.editionId,
            input.status,
            input.submitterName,
            input.submitterNsdaDigest,
            input.submitterNsdaMask,
            input.evidenceSha256,
            input.evidenceKind,
            input.evidenceUrl,
            input.evidenceSnapshotId,
            input.submittedAt,
            input.acceptedAt,
            input.rebuildState,
          ),
        ...input.placements.map((placement) =>
          db
            .prepare(
              "INSERT INTO mba_result_placements (submission_id, placement, competitor_id, submitted_name) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(
              input.id,
              placement.placement,
              placement.competitorId,
              placement.submittedName,
            ),
        ),
      ];
      await db.batch(statements);
      return input;
    },

    async acceptClaim(id, acceptedAt, evidenceSnapshotId, placements) {
      const parsed = MbaPlacementSchema.array().parse(placements);
      if (
        parsed.length !== 6 ||
        parsed.some(({ placement }, index) => placement !== index + 1)
      ) {
        throw new TypeError(
          "Accepted claims require placements one through six.",
        );
      }
      await db.batch([
        db
          .prepare(
            "UPDATE mba_result_submissions SET status = 'accepted', accepted_at = ?1, evidence_snapshot_id = ?2, rebuild_state = 'queued' WHERE id = ?3 AND status = 'processing'",
          )
          .bind(acceptedAt, evidenceSnapshotId, id),
        ...parsed.map((placement) =>
          db
            .prepare(
              "INSERT INTO mba_result_placements (submission_id, placement, competitor_id, submitted_name) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(
              id,
              placement.placement,
              placement.competitorId,
              placement.submittedName,
            ),
        ),
      ]);
      const row = await db
        .prepare("SELECT status FROM mba_result_submissions WHERE id = ?1")
        .bind(id)
        .first<{ status: string }>();
      if (row?.status !== "accepted")
        throw new Error("MBA submission claim is no longer active.");
    },

    async rejectClaim(id) {
      await db
        .prepare(
          "UPDATE mba_result_submissions SET status = 'rejected', rebuild_state = 'not-queued' WHERE id = ?1 AND status = 'processing'",
        )
        .bind(id)
        .run();
    },

    async status(seasonId) {
      const row = await db
        .prepare(
          "SELECT id, submitter_name, submitter_nsda_mask, evidence_sha256, evidence_kind, evidence_url, accepted_at, rebuild_state FROM mba_result_submissions WHERE season_id = ?1 AND status = 'accepted' LIMIT 1",
        )
        .bind(seasonId)
        .first<SubmissionRow>();
      if (row === null) return { accepted: false };
      const placements = await db
        .prepare(
          "SELECT placement, submitted_name FROM mba_result_placements WHERE submission_id = ?1 ORDER BY placement",
        )
        .bind(row.id)
        .all<PlacementRow>();
      return PublicMbaStatusSchema.parse({
        accepted: true,
        submitterName: row.submitter_name,
        submitterNsdaMask: row.submitter_nsda_mask,
        evidenceSha256: row.evidence_sha256,
        evidenceKind: row.evidence_kind,
        evidenceUrl: row.evidence_url,
        acceptedAt: row.accepted_at,
        rebuildState: row.rebuild_state,
        placements: placements.results.map((placement) => ({
          placement: placement.placement,
          name: placement.submitted_name,
        })),
      });
    },
  };
}
