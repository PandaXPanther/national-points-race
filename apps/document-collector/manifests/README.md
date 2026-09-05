# Official document manifest templates

Checked-in JSON files in this directory are the only official-document sources the scheduled collector will process. A template must declare `permission` as `official-public-document`, an exact hostname allowlist, a safe relative source path, and a strict parser manifest. Use `{editionId}` and `{retrievedAt}` in the two season-specific parser fields; the collector replaces them with each selected tournament edition and bounded-fetch timestamp. Templates apply to the current season, the stored previous season, and a rotating older season; paths must be relative to the discovered edition so a new year's results cannot overwrite a previous year's evidence.

No raw result documents or credentials belong in this directory. Tournaments handled through the public Tabroom export require no document template.
