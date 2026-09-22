CREATE TABLE pipeline_heartbeats (
  name TEXT PRIMARY KEY,
  installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

-- Allow the first real scheduled tick to arrive after deployment. Do not invent
-- a successful heartbeat from a deployment or a partial historical job batch.
INSERT INTO pipeline_heartbeats (name) VALUES ('scheduler');
