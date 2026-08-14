import type { APIRoute } from "astro";

import { HISTORICAL_SEASONS as historicalSeasons } from "../data/history.js";
import reconstruction from "../data/reconstruction/2025-26.json";
import { absoluteUrl, escapeXml } from "../lib/seo.js";

const staticPaths = [
  "/",
  "/history/",
  "/methodology/",
  "/archive/",
  "/corrections/",
  "/2025-26/",
  "/2026-27/",
  "/2025-26/tournaments/",
  "/2026-27/tournaments/",
] as const;

const paths = Array.from(
  new Set([
    ...staticPaths,
    ...historicalSeasons.map(({ seasonId }) => `/archive/${seasonId}/`),
    ...reconstruction.standings.map(
      ({ rank }) => `/2025-26/competitors/${rank}/`,
    ),
  ]),
).sort((left, right) => left.localeCompare(right));

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((path) => `  <url><loc>${escapeXml(absoluteUrl(path))}</loc></url>`).join("\n")}
</urlset>
`;

export const GET: APIRoute = () =>
  new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
