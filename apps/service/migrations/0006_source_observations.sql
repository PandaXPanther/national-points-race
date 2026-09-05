CREATE TABLE source_observations (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  snapshot_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  FOREIGN KEY (snapshot_id, edition_id) REFERENCES source_snapshots(id, edition_id),
  UNIQUE (snapshot_id, observed_at)
);

CREATE INDEX source_observations_snapshot_time
  ON source_observations (snapshot_id, observed_at);
CREATE INDEX source_observations_edition_time
  ON source_observations (edition_id, observed_at);
