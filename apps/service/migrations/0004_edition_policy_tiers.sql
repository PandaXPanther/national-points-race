ALTER TABLE tournament_editions
  ADD COLUMN tier INTEGER CHECK (
    tier IS NULL OR (typeof(tier) = 'integer' AND tier BETWEEN 1 AND 5)
  );

UPDATE tournament_editions
SET tier = (
  SELECT tier
  FROM tournament_lineages
  WHERE tournament_lineages.id = tournament_editions.lineage_id
)
WHERE tier IS NULL;

CREATE TRIGGER tournament_editions_tier_required_insert
BEFORE INSERT ON tournament_editions
WHEN NEW.tier IS NULL
BEGIN
  SELECT RAISE(ABORT, 'tournament edition tier is required');
END;
CREATE TRIGGER tournament_editions_tier_required_update
BEFORE UPDATE OF tier ON tournament_editions
WHEN NEW.tier IS NULL
BEGIN
  SELECT RAISE(ABORT, 'tournament edition tier is required');
END;
