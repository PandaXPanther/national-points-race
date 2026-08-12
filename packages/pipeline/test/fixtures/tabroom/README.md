# Sanitized Tabroom fixture

- Endpoint: `https://www.tabroom.com/api/download_data.mhtml?tourn_id=38186`
- Retrieval date: 2026-08-11
- Original export: 2,456,736 bytes; SHA-256 `a45af71cdca382cc3ffee94c2d2120c16ccd92a98e6084ef429c5268a9deaacb`
- Sanitized fixture: 1,912 bytes; SHA-256 `67702510d84c8dc4e1a4f7044c7a88af37268408ce600536dfccdd9be37cad55`

The fixture retains only the public event/category IDs, one published final result set,
its final and semifinal round metadata, and the minimum school, entry, and student joins.
All competitors, schools, entries, students, and placements have been replaced with
synthetic values. Removed data includes registration settings, organizer/contact data,
judge and ballot records, rooms, video links, comments, unrelated events, other result
sets, and all unnecessary tournament metadata.
