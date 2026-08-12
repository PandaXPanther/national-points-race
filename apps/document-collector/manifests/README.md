# Official document manifest templates

Checked-in JSON files in this directory are the only official-document sources the scheduled collector will process. A template must declare `permission` as `official-public-document`, an exact hostname allowlist, a safe relative source path, and a strict parser manifest. Use `{editionId}` and `{retrievedAt}` in the two season-specific parser fields; the collector replaces them with the current tournament edition and bounded-fetch timestamp.

No raw result documents or credentials belong in this directory. Tournaments handled through the public Tabroom export require no document template.
