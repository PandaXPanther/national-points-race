import type { APIRoute } from "astro";

const robots = `User-agent: *
Allow: /

Sitemap: https://extempcentral.org/sitemap.xml
`;

export const GET: APIRoute = () =>
  new Response(robots, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
