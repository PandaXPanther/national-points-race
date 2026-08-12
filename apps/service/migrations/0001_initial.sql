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
  UNIQUE(lineage_id, season_id),
  UNIQUE(id, lineage_id)
);

CREATE TABLE source_descriptors (
  id TEXT PRIMARY KEY,
  source_class TEXT NOT NULL CHECK (
    source_class IN (
      'structured-official-export',
      'organizer-json-csv',
      'organizer-html-pdf',
      'written-authorized-feed'
    )
  ),
  allowlisted_hostnames_json TEXT NOT NULL,
  allowed_media_types_json TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (
    permission IN (
      'official-public-export',
      'official-public-document',
      'written-authorization'
    )
  ),
  semantic_sha256 TEXT NOT NULL,
  UNIQUE(id, semantic_sha256)
);

CREATE TABLE source_snapshots (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  descriptor_id TEXT NOT NULL,
  descriptor_sha256 TEXT NOT NULL,
  url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (
    permission IN (
      'official-public-export',
      'official-public-document',
      'written-authorization'
    )
  ),
  r2_key TEXT NOT NULL,
  FOREIGN KEY (descriptor_id, descriptor_sha256)
    REFERENCES source_descriptors(id, semantic_sha256),
  UNIQUE(id, edition_id),
  UNIQUE(id, edition_id, descriptor_id, sha256),
  UNIQUE(edition_id, descriptor_id, sha256)
);

CREATE TABLE normalized_evidence_groups (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  semantic_sha256 TEXT NOT NULL,
  FOREIGN KEY (snapshot_id, edition_id)
    REFERENCES source_snapshots(id, edition_id),
  UNIQUE(id, edition_id, snapshot_id)
);

CREATE TABLE normalized_result_sets (
  id TEXT PRIMARY KEY,
  evidence_group_id TEXT NOT NULL,
  edition_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_division TEXT NOT NULL CHECK (
    event_division IN ('combined', 'ix', 'usx')
  ),
  event_eligible INTEGER NOT NULL CHECK (event_eligible IN (0, 1)),
  published_at TEXT NOT NULL,
  explicit_final INTEGER NOT NULL CHECK (explicit_final IN (0, 1)),
  correction INTEGER NOT NULL CHECK (correction IN (0, 1)),
  manifest_rule_id TEXT,
  FOREIGN KEY (evidence_group_id, edition_id, snapshot_id)
    REFERENCES normalized_evidence_groups(id, edition_id, snapshot_id),
  FOREIGN KEY (edition_id, lineage_id)
    REFERENCES tournament_editions(id, lineage_id),
  UNIQUE(id, evidence_group_id, edition_id, snapshot_id),
  UNIQUE(id, edition_id, snapshot_id),
  UNIQUE(snapshot_id, event_id, event_division)
);

CREATE TABLE normalized_results (
  id TEXT PRIMARY KEY,
  evidence_group_id TEXT NOT NULL,
  result_set_id TEXT NOT NULL,
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
  FOREIGN KEY (result_set_id, evidence_group_id, edition_id, snapshot_id)
    REFERENCES normalized_result_sets(
      id,
      evidence_group_id,
      edition_id,
      snapshot_id
    ),
  FOREIGN KEY (snapshot_id, edition_id)
    REFERENCES source_snapshots(id, edition_id),
  UNIQUE(result_set_id, source_entry_id),
  UNIQUE(snapshot_id, event_key, source_entry_id)
);

CREATE TABLE parser_diagnostics (
  result_set_id TEXT NOT NULL REFERENCES normalized_result_sets(id),
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal >= 0
  ),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  edition_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  explanation TEXT NOT NULL,
  FOREIGN KEY (result_set_id, edition_id, snapshot_id)
    REFERENCES normalized_result_sets(id, edition_id, snapshot_id),
  PRIMARY KEY(result_set_id, ordinal)
);

CREATE TABLE source_people (
  evidence_group_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal >= 0
  ),
  edition_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('combined', 'ix', 'usx')),
  snapshot_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_person_id TEXT,
  source_entry_id TEXT NOT NULL,
  published_name TEXT NOT NULL,
  published_school TEXT NOT NULL,
  simultaneous_entry_context TEXT,
  FOREIGN KEY (evidence_group_id, edition_id, snapshot_id)
    REFERENCES normalized_evidence_groups(id, edition_id, snapshot_id),
  PRIMARY KEY(evidence_group_id, ordinal)
);

CREATE TABLE explicit_identity_edges (
  evidence_group_id TEXT NOT NULL REFERENCES normalized_evidence_groups(id),
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal >= 0
  ),
  left_source_person_key TEXT NOT NULL,
  right_source_person_key TEXT NOT NULL,
  PRIMARY KEY(evidence_group_id, ordinal)
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
  policy_version_id TEXT NOT NULL REFERENCES policy_versions(id),
  version_sha256 TEXT NOT NULL,
  top25_standings_sha256 TEXT NOT NULL,
  cutoff_key TEXT NOT NULL,
  cutoff_tournament_order INTEGER NOT NULL CHECK (
    typeof(cutoff_tournament_order) = 'integer' AND
    cutoff_tournament_order >= 0
  ),
  cutoff_date TEXT NOT NULL,
  UNIQUE(season_id, input_sha256),
  UNIQUE(season_id, version_sha256)
);

CREATE TABLE standings_competitors (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  display_name TEXT NOT NULL,
  display_school TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  matched_alias TEXT,
  canonical_school_id TEXT NOT NULL,
  canonical_school_name TEXT NOT NULL,
  verified_source_person_keys_json TEXT NOT NULL,
  identity_evidence_json TEXT NOT NULL,
  PRIMARY KEY(standings_version_id, competitor_id)
);

CREATE TABLE standings_top25_members (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  position INTEGER NOT NULL CHECK (
    typeof(position) = 'integer' AND position BETWEEN 1 AND 25
  ),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  FOREIGN KEY (standings_version_id, competitor_id)
    REFERENCES standings_competitors(standings_version_id, competitor_id),
  PRIMARY KEY(standings_version_id, position),
  UNIQUE(standings_version_id, competitor_id)
);

CREATE TABLE standings_diagnostics (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  ordinal INTEGER NOT NULL CHECK (
    typeof(ordinal) = 'integer' AND ordinal >= 0
  ),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
  edition_id TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('combined', 'ix', 'usx')),
  source_snapshot_ids_json TEXT NOT NULL,
  source_entry_ids_json TEXT,
  explanation TEXT NOT NULL,
  PRIMARY KEY(standings_version_id, ordinal)
);

CREATE TABLE awards (
  id TEXT PRIMARY KEY,
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  event_id TEXT NOT NULL,
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  display_name TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  source_descriptor_id TEXT NOT NULL,
  source_class TEXT NOT NULL CHECK (
    source_class IN (
      'structured-official-export',
      'organizer-json-csv',
      'organizer-html-pdf',
      'written-authorized-feed'
    )
  ),
  snapshot_sha256 TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (
    permission IN (
      'official-public-export',
      'official-public-document',
      'written-authorization'
    )
  ),
  published_at TEXT NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('combined', 'ix', 'usx')),
  lineage_id TEXT NOT NULL,
  placement INTEGER CHECK (
    placement IS NULL OR (typeof(placement) = 'integer' AND placement > 0)
  ),
  furthest_stage TEXT NOT NULL CHECK (
    furthest_stage IN ('octafinal', 'quarterfinal', 'semifinal', 'final')
  ),
  won_final_round INTEGER NOT NULL CHECK (won_final_round IN (0, 1)),
  rule_id TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (
    typeof(points) = 'integer' AND points >= 0
  ),
  win INTEGER NOT NULL CHECK (win IN (0, 1)),
  top_three INTEGER NOT NULL CHECK (top_three IN (0, 1)),
  final INTEGER NOT NULL CHECK (final IN (0, 1)),
  FOREIGN KEY (snapshot_id, edition_id)
    REFERENCES source_snapshots(id, edition_id),
  FOREIGN KEY (edition_id, lineage_id)
    REFERENCES tournament_editions(id, lineage_id),
  FOREIGN KEY (
    snapshot_id,
    edition_id,
    source_descriptor_id,
    snapshot_sha256
  ) REFERENCES source_snapshots(id, edition_id, descriptor_id, sha256),
  FOREIGN KEY (standings_version_id, competitor_id)
    REFERENCES standings_competitors(standings_version_id, competitor_id),
  UNIQUE(standings_version_id, edition_id, competitor_id)
);

CREATE TABLE standings_rows (
  standings_version_id TEXT NOT NULL REFERENCES standings_versions(id),
  competitor_id TEXT NOT NULL REFERENCES canonical_competitors(id),
  display_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (typeof(rank) = 'integer' AND rank > 0),
  points INTEGER NOT NULL CHECK (
    typeof(points) = 'integer' AND points >= 0
  ),
  wins INTEGER NOT NULL CHECK (typeof(wins) = 'integer' AND wins >= 0),
  top_threes INTEGER NOT NULL CHECK (
    typeof(top_threes) = 'integer' AND top_threes >= 0
  ),
  finals INTEGER NOT NULL CHECK (typeof(finals) = 'integer' AND finals >= 0),
  FOREIGN KEY (standings_version_id, competitor_id)
    REFERENCES standings_competitors(standings_version_id, competitor_id),
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

CREATE INDEX idx_source_snapshots_r2_key
  ON source_snapshots(r2_key);

CREATE INDEX idx_normalized_result_sets_edition
  ON normalized_result_sets(edition_id, published_at);

CREATE INDEX idx_normalized_results_edition
  ON normalized_results(edition_id);

CREATE INDEX idx_awards_competitor_edition
  ON awards(competitor_id, edition_id);

CREATE INDEX idx_standings_versions_season_created
  ON standings_versions(season_id, created_at, id);

CREATE INDEX idx_job_runs_state_scheduled_for
  ON job_runs(state, scheduled_for);
