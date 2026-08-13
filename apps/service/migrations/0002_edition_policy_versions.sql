ALTER TABLE tournament_editions
  ADD COLUMN policy_version_id TEXT REFERENCES policy_versions(id);

UPDATE tournament_editions
SET policy_version_id = (
  SELECT policy_version_id
  FROM tournament_lineages
  WHERE tournament_lineages.id = tournament_editions.lineage_id
)
WHERE policy_version_id IS NULL;

CREATE TRIGGER tournament_editions_policy_required_insert
BEFORE INSERT ON tournament_editions
WHEN NEW.policy_version_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'tournament edition policy version is required');
END;

CREATE TRIGGER tournament_editions_policy_required_update
BEFORE UPDATE OF policy_version_id ON tournament_editions
WHEN NEW.policy_version_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'tournament edition policy version is required');
END;

CREATE INDEX idx_tournament_editions_policy_version
  ON tournament_editions(policy_version_id, season_id);
