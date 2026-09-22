# Verified recurring Tabroom discovery

Verified on 2026-09-21 (2026-09-22T01:32:50.062Z), using anonymous official public HTML only. Each historical detail page linked to its Past Years index; the index linked back to the same checked-in historical tournament ID. No tournament IDs or webnames were inferred from fuzzy names. Requests were bounded to 5 MiB and 30 seconds; no result exports were requested.

## Provenance

The registry uses keys of the form `tabroom:webname:<webname>`. Titles below are observed examples, not permission to accept arbitrary titles sharing an index.

| Policy lineage          | Historical detail                                                       | Verified index                                                                              | Observed title                                          |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| uk-season-opener        | [36144](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36144) | [ukso](https://www.tabroom.com/index/tourn/past.mhtml?webname=ukso)                         | National Speech and Debate Season Opener                |
| yale                    | [35805](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35805) | [yale](https://www.tabroom.com/index/tourn/past.mhtml?webname=yale)                         | Yale Invitational                                       |
| nyc-invitational        | [35754](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35754) | [nyc](https://www.tabroom.com/index/tourn/past.mhtml?webname=nyc)                           | New York City Invitational Debate and Speech Tournament |
| florida-blue-key        | [36201](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36201) | [flbluekey](https://www.tabroom.com/index/tourn/past.mhtml?webname=flbluekey)               | Florida Blue Key Speech and Debate Tournament           |
| glenbrooks              | [35020](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35020) | [glenbrooks](https://www.tabroom.com/index/tourn/past.mhtml?webname=glenbrooks)             | Glenbrooks Speech and Debate Tournament                 |
| longhorn-classic        | [35025](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35025) | [lhc](https://www.tabroom.com/index/tourn/past.mhtml?webname=lhc)                           | The Longhorn Classic                                    |
| princeton-classic       | [37048](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=37048) | [princetonclassic](https://www.tabroom.com/index/tourn/past.mhtml?webname=princetonclassic) | Princeton Classic                                       |
| mba-round-robin         | [38655](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=38655) | [mbasbf](https://www.tabroom.com/index/tourn/past.mhtml?webname=mbasbf)                     | MBA Extemporaneous Speaking Round Robin                 |
| james-logan-mlk         | [36275](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36275) | [mlk](https://www.tabroom.com/index/tourn/past.mhtml?webname=mlk)                           | James Logan Martin Luther King Jr Invitational          |
| barkley-forum           | [35556](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35556) | [bfhs](https://www.tabroom.com/index/tourn/past.mhtml?webname=bfhs)                         | Barkley Forum for High Schools                          |
| harvard                 | [36222](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36222) | [harvard](https://www.tabroom.com/index/tourn/past.mhtml?webname=harvard)                   | Harvard National Speech and Debate Tournament           |
| stanford                | [35262](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35262) | [stanford](https://www.tabroom.com/index/tourn/past.mhtml?webname=stanford)                 | 40th Annual Stanford Invitational                       |
| california-invitational | [35299](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=35299) | [berkeley](https://www.tabroom.com/index/tourn/past.mhtml?webname=berkeley)                 | Cal Invitational UC Berkeley                            |
| uk-toc                  | [36156](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36156) | [toc](https://www.tabroom.com/index/tourn/past.mhtml?webname=toc)                           | 54th Annual Tournament of Champions                     |
| ncfl-nationals          | [39322](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=39322) | [ncfl](https://www.tabroom.com/index/tourn/past.mhtml?webname=ncfl)                         | NCFL Grand Nationals                                    |
| nsda-nationals          | [37602](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=37602) | [nationals](https://www.tabroom.com/index/tourn/past.mhtml?webname=nationals)               | National Speech and Debate Tournament                   |
| apple-valley-minneapple | [36266](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=36266) | [minneapple](https://www.tabroom.com/index/tourn/past.mhtml?webname=minneapple)             | Apple Valley MinneApple Debate Tournament               |
| asu-hdshc-invitational  | [37484](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=37484) | [asu](https://www.tabroom.com/index/tourn/past.mhtml?webname=asu)                           | Arizona State HDSHC Invitational                        |

## Live discovery verification

At 2026-09-22T01:39:52.368Z, the exported `discoverTabroomCandidates` and `matchLineage` functions fetched the live calendar, verified recurring index, current detail, and event pages. All three matched through the verified platform key with the title guard and no organizer attribute.

| Tournament       | Current edition                                                         | Detail dates             | Eligible label          |
| ---------------- | ----------------------------------------------------------------------- | ------------------------ | ----------------------- |
| Yale             | [38436](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=38436) | 2026-10-02 to 2026-10-04 | Extemp                  |
| NYC              | [39028](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=39028) | 2026-10-16 to 2026-10-18 | Extemporaneous Speaking |
| Florida Blue Key | [38785](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=38785) | 2026-10-29 to 2026-11-01 | Extemporaneous Speaking |

Blue Key also lists `Extemporaneous Speaking RR`; it remains excluded. This check proves live discovery and matching, not final-results publication, export normalization, or scoring.

## Identity and date safeguards

- Past Years indexes are not exclusive identity proofs. The nationals index includes Nano Nagle, Harker Intramural, and Test; flbluekey includes tests and a separate round robin; minneapple includes MN NSDA Scrimmage; mbasbf includes the Billy Tate Southern Bell Forum. Require reviewed exact title forms in addition to a webname. Only the anchored Stanford, UK TOC, and Berkeley annual-ordinal forms permit ordinal progression. Multiple viable candidates remain ambiguous.
- None of the 17 audited historical detail pages exposed `data-organizer`. Organizer aliases alone cannot establish exact-fact identity on those real pages.
- Prefer detailed dates when present. Some detail pages omit the dates section, including current [Stanford 40749](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=40749) and [MBA 40932](https://www.tabroom.com/index/tourn/index.mhtml?tourn_id=40932). Only use an explicit start and end from a verified current-season index row when the detail corroborates both webname and reviewed title. Reject invalid, reversed, cross-season, or contradictory intervals. Index dates are used as published; no exclusive-end or timezone offset is invented.
- Index/detail boundaries can differ by one day. For example, James Logan's historical detail says January 16–18 while its index says January 17–19. Require overlapping intervals and prefer the detailed interval. Date windows and eligible event checks still apply.

## Remaining provider limitations

George Mason, Extemp TOC, and NIETOC use SpeechWire in the checked-in historical manifest. Their reviewed PDF reconstruction is not a live automatic SpeechWire discovery adapter; health must report that configuration gap honestly. MBA discovery does not prove that the normal export supplies its required cumulative top six; its reviewed cumulative packet/submission path remains distinct. MinneApple's verified historical source is a debate tournament without eligible extemp, so the recurring key does not make that edition scoreable. The verified UK TOC and NCFL indexes had no 2026–27 edition yet; the only current-season nationals row was unrelated Nano Nagle.
