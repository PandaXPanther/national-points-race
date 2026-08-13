CREATE UNIQUE INDEX idx_tournament_editions_id_season
  ON tournament_editions(id, season_id);

CREATE TABLE mba_result_submissions (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'accepted', 'rejected')),
  submitter_name TEXT NOT NULL CHECK (length(trim(submitter_name)) > 0),
  submitter_nsda_digest TEXT NOT NULL CHECK (
    length(submitter_nsda_digest) = 64 AND
    submitter_nsda_digest NOT GLOB '*[^0-9a-f]*'
  ),
  submitter_nsda_mask TEXT NOT NULL CHECK (
    submitter_nsda_mask GLOB '•••[0-9][0-9][0-9][0-9]'
  ),
  evidence_sha256 TEXT NOT NULL CHECK (
    length(evidence_sha256) = 64 AND
    evidence_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('upload', 'official-url')),
  evidence_url TEXT,
  evidence_snapshot_id TEXT REFERENCES source_snapshots(id),
  submitted_at TEXT NOT NULL,
  accepted_at TEXT,
  rebuild_state TEXT NOT NULL CHECK (
    rebuild_state IN ('not-queued', 'queued', 'published', 'failed')
  ),
  CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL) OR
    (status IN ('processing', 'rejected') AND accepted_at IS NULL)
  ),
  CHECK (
    (evidence_kind = 'upload' AND evidence_url IS NULL) OR
    (evidence_kind = 'official-url' AND evidence_url IS NOT NULL)
  ),
  FOREIGN KEY (edition_id, season_id)
    REFERENCES tournament_editions(id, season_id)
);

CREATE TABLE mba_result_placements (
  submission_id TEXT NOT NULL REFERENCES mba_result_submissions(id),
  placement INTEGER NOT NULL CHECK (
    typeof(placement) = 'integer' AND placement BETWEEN 1 AND 6
  ),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  submitted_name TEXT NOT NULL CHECK (length(trim(submitted_name)) > 0),
  PRIMARY KEY(submission_id, placement),
  UNIQUE(submission_id, competitor_id)
);

CREATE UNIQUE INDEX idx_mba_one_active_per_season
  ON mba_result_submissions(season_id)
  WHERE status IN ('processing', 'accepted');

CREATE INDEX idx_mba_submissions_season_status
  ON mba_result_submissions(season_id, status, submitted_at);
