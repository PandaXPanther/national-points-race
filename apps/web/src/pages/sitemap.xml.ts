import type { APIRoute } from "astro";

import reconstruction from "../data/reconstruction/2025-26.json";
import { absoluteUrl, escapeXml } from "../lib/seo.js";
import { loadSeasonCatalog } from "../lib/seasons.js";

const staticPaths = [
  "/",
  "/history/",
  "/methodology/",
  "/archive/",
  "/corrections/",
  "/2025-26/",
  "/2025-26/tournaments/",
] as const;

export const GET: APIRoute = async () => {
  const catalog = await loadSeasonCatalog();
  const paths = Array.from(
    new Set([
      ...staticPaths,
      `/${catalog.currentSeasonId}/`,
      `/${catalog.currentSeasonId}/tournaments/`,
      ...catalog.archives.map(({ seasonId }) => `/archive/${seasonId}/`),
      ...catalog.archives
        .filter((season) => season.kind === "live")
        .map(({ seasonId }) => `/${seasonId}/tournaments/`),
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

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
};
