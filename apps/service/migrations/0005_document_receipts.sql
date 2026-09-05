CREATE TABLE document_ingest_receipts (
  edition_id TEXT NOT NULL REFERENCES tournament_editions(id),
  descriptor_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  snapshot_id TEXT NOT NULL REFERENCES source_snapshots(id),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (edition_id, descriptor_id, source_url)
);
