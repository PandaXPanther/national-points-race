import type { APIRoute } from "astro";
import { currentSeasonId } from "../lib/seasons.js";

export const GET: APIRoute = () =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/${currentSeasonId()}/`,
      "Cache-Control": "no-store",
    },
  });
