import { fetchBounded, SourceDescriptorSchema } from "@points-race/pipeline";
import { z } from "zod";

export const CollectionSeasonIdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/u)
  .refine(
    (value) => Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100,
  );

const CatalogSchema = z.object({
  currentSeasonId: CollectionSeasonIdSchema,
  seasons: z.array(z.object({ seasonId: CollectionSeasonIdSchema })),
});

export async function collectionSeasons(input: {
  readonly serviceUrl: string;
  readonly currentSeasonId: string;
  readonly date: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<readonly string[]> {
  const origin = new URL(input.serviceUrl);
  const response = await fetchBounded({
    url: new URL("/v1/seasons", origin),
    descriptor: SourceDescriptorSchema.parse({
      id: "points-race-public-api-v1",
      sourceClass: "organizer-json-csv",
      allowlistedHostnames: [origin.hostname],
      allowedMediaTypes: ["application/json"],
      permission: "official-public-export",
    }),
    maxBytes: 1_048_576,
    timeoutMs: 30_000,
    acceptedTypes: ["application/json"],
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });
  const catalog = CatalogSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(response.body),
    ) as unknown,
  );
  const current = CollectionSeasonIdSchema.parse(input.currentSeasonId);
  const startYear = Number(current.slice(0, 4));
  const previous = `${startYear - 1}-${String(startYear % 100).padStart(2, "0")}`;
  const persisted = [
    ...new Set(catalog.seasons.map(({ seasonId }) => seasonId)),
  ]
    .filter((id) => id >= "2026-27" && id < current)
    .sort();
  const older = persisted.filter((id) => id !== previous);
  const day = Math.floor(input.date.getTime() / 86_400_000);
  const rotated = older.length === 0 ? undefined : older[day % older.length];
  return [
    current,
    ...(persisted.includes(previous) ? [previous] : []),
    ...(rotated === undefined ? [] : [rotated]),
  ];
}
