import type { ZodType } from "zod";

import {
  CompetitorResponseSchema,
  SeasonCatalogResponseSchema,
  StandingsResponseSchema,
  TournamentIndexResponseSchema,
  type CompetitorResponse,
  type SeasonCatalogResponse,
  type StandingsResponse,
  type TournamentIndexResponse,
} from "./contracts.js";

export type PublicApiErrorCode =
  | "PUBLIC_API_UNAVAILABLE"
  | "PUBLIC_API_TIMEOUT"
  | "PUBLIC_API_HTTP"
  | "PUBLIC_API_CONTRACT";

export class PublicApiError extends Error {
  readonly code: PublicApiErrorCode;
  readonly status?: number;

  constructor(code: PublicApiErrorCode, status?: number) {
    super(messageFor(code));
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiContext {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly etag?: string;
}

function messageFor(code: PublicApiErrorCode): string {
  switch (code) {
    case "PUBLIC_API_TIMEOUT":
      return "The public points race API timed out.";
    case "PUBLIC_API_HTTP":
      return "The public points race API returned an error.";
    case "PUBLIC_API_CONTRACT":
      return "The public points race API returned an invalid response.";
    case "PUBLIC_API_UNAVAILABLE":
      return "The public points race API is unavailable.";
  }
}

function endpoint(baseUrl: string, path: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new PublicApiError("PUBLIC_API_UNAVAILABLE");
  }

  const local =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new PublicApiError("PUBLIC_API_UNAVAILABLE");
  }

  return new URL(path, `${parsed.href.replace(/\/$/u, "")}/`);
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  context: ApiContext,
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = context.timeoutMs ?? 10_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers({ accept: "application/json" });
  if (context.etag !== undefined) {
    headers.set("if-none-match", context.etag);
  }

  try {
    const response = await (context.fetchImpl ?? fetch)(
      endpoint(context.baseUrl, path),
      { headers, signal: controller.signal },
    );
    if (!response.ok) {
      throw new PublicApiError("PUBLIC_API_HTTP", response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PublicApiError("PUBLIC_API_CONTRACT");
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PublicApiError("PUBLIC_API_CONTRACT");
    }
    return parsed.data;
  } catch (error: unknown) {
    if (error instanceof PublicApiError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new PublicApiError("PUBLIC_API_TIMEOUT");
    }
    throw new PublicApiError("PUBLIC_API_UNAVAILABLE");
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getStandings(
  seasonId: string,
  context: ApiContext,
): Promise<StandingsResponse> {
  return request(
    `v1/seasons/${encodeURIComponent(seasonId)}/standings`,
    StandingsResponseSchema,
    context,
  );
}

export function getSeasonCatalog(
  context: ApiContext,
): Promise<SeasonCatalogResponse> {
  return request("v1/seasons", SeasonCatalogResponseSchema, context);
}

export function getTournamentIndex(
  seasonId: string,
  context: ApiContext,
): Promise<TournamentIndexResponse> {
  return request(
    `v1/seasons/${encodeURIComponent(seasonId)}/tournaments`,
    TournamentIndexResponseSchema,
    context,
  );
}

export function getCompetitor(
  seasonId: string,
  competitorId: string,
  context: ApiContext,
): Promise<CompetitorResponse> {
  return request(
    `v1/seasons/${encodeURIComponent(seasonId)}/competitors/${encodeURIComponent(competitorId)}`,
    CompetitorResponseSchema,
    context,
  );
}
