CREATE TABLE policy_versions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ledger_sha256 TEXT NOT NULL UNIQUE
);

CREATE TABLE tournament_lineages (
  id TEXT PRIMARY KEY,
  policy_version_id TEXT NOT NULL REFERENCES policy_versions(id),
  tier INTEGER NOT NULL CHECK (
    typeof(tier) = 'integer' AND tier BETWEEN 1 AND 5
  ),
  canonical_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL
);

CREATE TABLE tournament_editions (
  id TEXT PRIMARY KEY,
  lineage_id TEXT NOT NULL REFERENCES tournament_lineages(id),
  season_id TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'discovering',
      'upcoming',
      'awaiting-results',
      'provisional',
      'final',
      'corrected',
      'not-held',
      'source-unavailable'
    )
  ),
  discovered_from TEXT,
  UNIQUE(lineage_id, season_id)
);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  descriptor_id TEXT NOT NULL,
  url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  permission TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  UNIQUE(id, edition_id),
  UNIQUE(edition_id, descriptor_id, sha256)
);

CREATE TABLE normalized_results (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  event_key TEXT NOT NULL,
  source_entry_id TEXT NOT NULL,
  source_person_key TEXT,
  published_name TEXT NOT NULL,
  published_school TEXT NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('combined', 'ix', 'usx')),
  placement INTEGER CHECK (
    placement IS NULL OR (typeof(placement) = 'integer' AND placement > 0)
  ),
  furthest_stage TEXT NOT NULL CHECK (
    furthest_stage IN ('octafinal', 'quarterfinal', 'semifinal', 'final')
  ),
  won_final_round INTEGER NOT NULL CHECK (won_final_round IN (0, 1)),
  explicitly_final INTEGER NOT NULL CHECK (explicitly_final IN (0, 1)),
  FOREIGN KEY (snapshot_id, edition_id)
    REFERENCES source_snapshots(id, edition_id),
  UNIQUE(snapshot_id, event_key, source_entry_id)
);

CREATE TABLE canonical_competitors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE identity_edges (
  source_person_key TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  rule_id TEXT NOT NULL,
  evidence_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE standings_versions (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('provisional', 'final', 'corrected')),
  UNIQUE(season_id, input_sha256)
);

CREATE TABLE awards (
  id TEXT PRIMARY KEY,
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  rule_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (
    typeof(points) = 'integer' AND points >= 0
  ),
  win INTEGER NOT NULL CHECK (win IN (0, 1)),
  top_three INTEGER NOT NULL CHECK (top_three IN (0, 1)),
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  FOREIGN KEY (snapshot_id, edition_id)
    REFERENCES source_snapshots(id, edition_id),
  UNIQUE(standings_version_id, edition_id, competitor_id)
);

CREATE TABLE standings_rows (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  rank INTEGER NOT NULL CHECK (typeof(rank) = 'integer' AND rank > 0),
  points INTEGER NOT NULL CHECK (
    typeof(points) = 'integer' AND points >= 0
  ),
  wins INTEGER NOT NULL CHECK (typeof(wins) = 'integer' AND wins >= 0),
  top_threes INTEGER NOT NULL CHECK (
    typeof(top_threes) = 'integer' AND top_threes >= 0
  ),
  finals INTEGER NOT NULL CHECK (typeof(finals) = 'integer' AND finals >= 0),
  PRIMARY KEY(standings_version_id, competitor_id)
);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  natural_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'queued',
      'running',
      'retrying',
      'succeeded',
      'failed',
      'dead_lettered'
    )
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof(attempts) = 'integer' AND attempts >= 0
  ),
  scheduled_for TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  diagnostic_json TEXT,
  UNIQUE(job_type, natural_key, scheduled_for)
);

CREATE TABLE job_leases (
  lease_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_tournament_editions_status_end_at
  ON tournament_editions(status, end_at);

CREATE INDEX idx_source_snapshots_edition_retrieved_at
  ON source_snapshots(edition_id, retrieved_at);

CREATE INDEX idx_normalized_results_edition
  ON normalized_results(edition_id);

CREATE INDEX idx_awards_competitor_edition
  ON awards(competitor_id, edition_id);

CREATE INDEX idx_job_runs_state_scheduled_for
  ON job_runs(state, scheduled_for);
