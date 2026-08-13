import { createHash } from "node:crypto";

import {
  SourceFetchError,
  TabroomExportSchema,
  type TabroomExport,
} from "@points-race/pipeline";
import parserWebStream from "stream-json/web";
import pick from "stream-json/web/filters/pick.js";
import streamValues from "stream-json/web/streamers/stream-values.js";
import { z } from "zod";

const ProviderIdSchema = z
  .union([z.string().min(1), z.number().int().safe()])
  .transform(String);

const BallotScoreSchema = z
  .object({
    tag: z.string().min(1),
    value: z.number().int().positive(),
  })
  .passthrough();

const BallotSchema = z
  .object({
    entry: ProviderIdSchema,
    entry_name: z.string().min(1).optional(),
    entry_code: z.union([z.string(), z.number().int().safe()]).optional(),
    scores: z.array(BallotScoreSchema).optional(),
  })
  .passthrough();

const SectionSchema = z
  .object({
    id: ProviderIdSchema,
    round: ProviderIdSchema,
    ballots: z.array(BallotSchema),
  })
  .passthrough();

const RoundSchema = z
  .object({
    id: ProviderIdSchema,
    label: z.string().min(1).nullish(),
    type: z.string().min(1).nullish(),
    sections: z.array(SectionSchema),
  })
  .passthrough();

const ResultSchema = z
  .object({
    entry: ProviderIdSchema,
    place: z.union([z.string(), z.number().int().safe()]).nullish(),
    round: ProviderIdSchema.nullish(),
  })
  .passthrough();

const ResultSetSchema = z
  .object({
    label: z.string().min(1),
    tag: z.string().min(1).optional(),
    bracket: z.union([z.string(), z.number().int().safe()]).optional(),
    published: z.union([z.boolean(), z.number().int().safe()]),
    generated: z.string().min(1).optional(),
    results: z.array(ResultSchema),
  })
  .passthrough();

const EventSchema = z
  .object({
    id: ProviderIdSchema,
    name: z.string().min(1),
    rounds: z.array(RoundSchema),
    result_sets: z.array(ResultSetSchema),
  })
  .passthrough();

const StudentSchema = z
  .object({
    id: ProviderIdSchema,
    first: z.string().min(1),
    last: z.string().min(1),
  })
  .passthrough();

const EntrySchema = z
  .object({
    id: ProviderIdSchema,
    event: ProviderIdSchema,
    students: z.array(ProviderIdSchema).min(1),
    name: z.string().min(1),
  })
  .passthrough();

const SchoolSchema = z
  .object({
    id: ProviderIdSchema,
    name: z.string().min(1),
    entries: z.array(EntrySchema),
    students: z.array(StudentSchema),
  })
  .passthrough();

const ELIGIBLE_EVENT_KEYS = new Set(
  [
    "extemp",
    "extemporaneous",
    "extemporaneous speaking",
    "international extemp",
    "international extemporaneous speaking",
    "ix",
    "national extemp",
    "open extemp",
    "united states extemp",
    "united states extemporaneous speaking",
    "us extemp",
    "usx",
  ].map(normalizeEventKey),
);

export type TabroomStreamErrorCode =
  "TABROOM_ELIGIBLE_EVENT_NOT_FOUND" | "TABROOM_STREAM_INVALID";

export class TabroomStreamError extends Error {
  readonly code: TabroomStreamErrorCode;

  constructor(code: TabroomStreamErrorCode, message: string) {
    super(message);
    this.name = "TabroomStreamError";
    this.code = code;
  }
}

export interface CompactTabroomExportInput {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly tournamentId: number;
  readonly maxBytes: number;
}

export interface CompactTabroomExportOutput {
  readonly payload: TabroomExport;
  readonly byteLength: number;
  readonly sha256: string;
  readonly finalRoundWinners: readonly FinalRoundWinner[];
}

export interface FinalRoundWinner {
  readonly eventId: string;
  readonly sourceEntryId: string;
  readonly ballotCount: number;
  readonly rankTotal: number;
}

export async function compactTabroomExportStream(
  input: CompactTabroomExportInput,
): Promise<CompactTabroomExportOutput> {
  validateInput(input);
  if (input.body === null) {
    throw new SourceFetchError(
      "SOURCE_MISSING_BODY",
      "Tabroom export response did not contain a body.",
    );
  }

  const digest = createHash("sha256");
  let byteLength = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      byteLength += chunk.byteLength;
      if (byteLength > input.maxBytes) {
        throw new SourceFetchError(
          "SOURCE_TOO_LARGE",
          "Tabroom export exceeded the configured streaming byte limit.",
        );
      }
      digest.update(chunk);
      controller.enqueue(chunk);
    },
  });
  const parser = parserWebStream();
  const selected = pick.asWebStream({
    filter: /(^|\.)(events|schools)\.\d+$/u,
    maxDepth: 128,
  });
  const values = streamValues.asWebStream();
  const events: z.infer<typeof EventSchema>[] = [];
  const schools: z.infer<typeof SchoolSchema>[] = [];

  try {
    const output = input.body
      .pipeThrough(bounded)
      .pipeThrough(parser)
      .pipeThrough(selected)
      .pipeThrough(values);
    for await (const item of output) {
      const value = (item as Readonly<{ value: unknown }>).value;
      const event = EventSchema.safeParse(value);
      if (event.success) {
        if (isEligibleEventName(event.data.name)) {
          events.push(event.data);
        }
        continue;
      }
      const school = SchoolSchema.safeParse(value);
      if (school.success) schools.push(school.data);
    }
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    throw new TabroomStreamError(
      "TABROOM_STREAM_INVALID",
      "Tabroom export could not be parsed as a bounded JSON stream.",
    );
  }

  if (events.length === 0) {
    throw new TabroomStreamError(
      "TABROOM_ELIGIBLE_EVENT_NOT_FOUND",
      "Tabroom export contained no eligible extemp event.",
    );
  }

  const eventIds = new Set(events.map(({ id }) => id));
  const compactSchools = schools
    .map((school) => {
      const entries = school.entries.filter(({ event }) => eventIds.has(event));
      const studentIds = new Set(entries.flatMap(({ students }) => students));
      return {
        id: school.id,
        name: school.name,
        entries: entries.map(({ id, event, students: people, name }) => ({
          id,
          event,
          students: people,
          name,
        })),
        students: school.students
          .filter(({ id }) => studentIds.has(id))
          .map(({ id, first, last }) => ({ id, first, last })),
      };
    })
    .filter(({ entries }) => entries.length > 0);
  const existingEntryIds = new Set(
    compactSchools.flatMap(({ entries }) => entries.map(({ id }) => id)),
  );
  const missingEntries = collectPublishedBallotEntries(
    events,
    existingEntryIds,
  );
  if (missingEntries.length > 0) {
    compactSchools.push({
      id: `streamed:unpublished-school:${input.tournamentId}`,
      name: `School not included in Tabroom export ${input.tournamentId}`,
      entries: missingEntries.map(({ entryId, eventId, publishedName }) => ({
        id: entryId,
        event: eventId,
        students: [`streamed:person:${input.tournamentId}:${entryId}`],
        name: publishedName,
      })),
      students: missingEntries.map(({ entryId, publishedName }) => ({
        id: `streamed:person:${input.tournamentId}:${entryId}`,
        first: publishedName,
        last: "[name published as one field]",
      })),
    });
  }
  const entryIds = new Set(
    compactSchools.flatMap(({ entries }) => entries.map(({ id }) => id)),
  );
  const compactEvents = events.map((event) => ({
    id: event.id,
    name: event.name,
    rounds: event.rounds.map((round) => ({
      id: round.id,
      label: round.label,
      type: round.type,
      sections: round.sections.map((section) => ({
        id: section.id,
        round: section.round,
        ballots: section.ballots
          .filter(({ entry }) => entryIds.has(entry))
          .map(({ entry }) => ({ entry })),
      })),
    })),
    result_sets: event.result_sets.map((resultSet) => ({
      label: resultSet.label,
      ...(resultSet.tag === undefined ? {} : { tag: resultSet.tag }),
      ...(resultSet.bracket === undefined
        ? {}
        : { bracket: resultSet.bracket }),
      published: resultSet.published,
      ...(resultSet.generated === undefined
        ? {}
        : { generated: resultSet.generated }),
      results: resultSet.results.map(({ entry, place, round }) => ({
        entry,
        place,
        round,
      })),
    })),
  }));

  const payload = TabroomExportSchema.parse({
    id: String(input.tournamentId),
    categories: [
      { id: `streamed:${input.tournamentId}`, events: compactEvents },
    ],
    schools: compactSchools,
  });
  return {
    payload,
    byteLength,
    sha256: digest.digest("hex"),
    finalRoundWinners: deriveFinalRoundWinners(events),
  };
}

function normalizeEventKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s+(?:online|in person)$/u, "");
}

function isEligibleEventName(value: string): boolean {
  const normalized = normalizeEventKey(value);
  if (/\b(?:jv|junior varsity|novice)\b/u.test(normalized)) return false;
  const withoutDivisionMarkers = normalized
    .replace(/^[a-z]\s+/u, "")
    .replace(/\s+varsity$/u, "");
  return ELIGIBLE_EVENT_KEYS.has(withoutDivisionMarkers);
}

interface PublishedBallotEntry {
  readonly entryId: string;
  readonly eventId: string;
  readonly publishedName: string;
}

function collectPublishedBallotEntries(
  events: readonly z.infer<typeof EventSchema>[],
  existingEntryIds: ReadonlySet<string>,
): readonly PublishedBallotEntry[] {
  const entries = new Map<string, PublishedBallotEntry>();
  const requiredEntryIds = new Set(
    events.flatMap(({ result_sets: resultSets }) =>
      resultSets.flatMap(({ results }) => results.map(({ entry }) => entry)),
    ),
  );

  for (const event of events) {
    for (const round of event.rounds) {
      for (const section of round.sections) {
        for (const ballot of section.ballots) {
          if (existingEntryIds.has(ballot.entry)) continue;
          const publishedName = ballot.entry_name?.normalize("NFKC").trim();
          if (publishedName === undefined || publishedName === "") continue;
          const candidate = {
            entryId: ballot.entry,
            eventId: event.id,
            publishedName,
          } as const;
          const prior = entries.get(ballot.entry);
          if (
            prior !== undefined &&
            (prior.eventId !== candidate.eventId ||
              prior.publishedName !== candidate.publishedName)
          ) {
            throw new TabroomStreamError(
              "TABROOM_STREAM_INVALID",
              "Tabroom ballot identity fields contradicted one another.",
            );
          }
          entries.set(ballot.entry, candidate);
        }
      }
    }
  }

  for (const entryId of requiredEntryIds) {
    if (!existingEntryIds.has(entryId) && !entries.has(entryId)) {
      throw new TabroomStreamError(
        "TABROOM_STREAM_INVALID",
        "Tabroom result entry had no published identity evidence.",
      );
    }
  }
  return [...entries.values()].sort((left, right) =>
    left.entryId.localeCompare(right.entryId),
  );
}

function deriveFinalRoundWinners(
  events: readonly z.infer<typeof EventSchema>[],
): readonly FinalRoundWinner[] {
  const winners: FinalRoundWinner[] = [];
  for (const event of events) {
    const finalRounds = event.rounds.filter(
      (round) =>
        round.type?.trim().toLocaleLowerCase("en-US") === "final" ||
        (round.label !== null &&
          round.label !== undefined &&
          normalizeEventKey(round.label) === "final"),
    );
    if (finalRounds.length === 0) continue;
    if (finalRounds.length !== 1) {
      throw new TabroomStreamError(
        "TABROOM_STREAM_INVALID",
        "Tabroom event contained more than one final round.",
      );
    }
    const ranks = new Map<string, number[]>();
    let rankedBallots = 0;
    for (const section of finalRounds[0]!.sections) {
      for (const ballot of section.ballots) {
        const rankScores =
          ballot.scores?.filter(
            ({ tag }) => tag.trim().toLocaleLowerCase("en-US") === "rank",
          ) ?? [];
        if (rankScores.length === 0) continue;
        if (rankScores.length !== 1) {
          throw new TabroomStreamError(
            "TABROOM_STREAM_INVALID",
            "Tabroom final ballot contained conflicting rank scores.",
          );
        }
        rankedBallots += 1;
        const values = ranks.get(ballot.entry) ?? [];
        values.push(rankScores[0]!.value);
        ranks.set(ballot.entry, values);
      }
    }
    if (rankedBallots === 0) continue;
    const counts = new Set([...ranks.values()].map((values) => values.length));
    if (counts.size !== 1) {
      throw new TabroomStreamError(
        "TABROOM_STREAM_INVALID",
        "Tabroom final entries did not have equal ranked ballot counts.",
      );
    }
    const totals = [...ranks].map(([sourceEntryId, values]) => ({
      sourceEntryId,
      ballotCount: values.length,
      rankTotal: values.reduce((sum, value) => sum + value, 0),
    }));
    const minimum = Math.min(...totals.map(({ rankTotal }) => rankTotal));
    const minimumEntries = totals.filter(
      ({ rankTotal }) => rankTotal === minimum,
    );
    if (minimumEntries.length !== 1) {
      throw new TabroomStreamError(
        "TABROOM_STREAM_INVALID",
        "Tabroom final rank totals did not identify one winner.",
      );
    }
    winners.push({ eventId: event.id, ...minimumEntries[0]! });
  }
  return winners.sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  );
}

function validateInput(input: CompactTabroomExportInput): void {
  if (!Number.isSafeInteger(input.tournamentId) || input.tournamentId <= 0) {
    throw new TabroomStreamError(
      "TABROOM_STREAM_INVALID",
      "Tabroom tournament ID must be a positive safe integer.",
    );
  }
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new SourceFetchError(
      "SOURCE_INVALID_CONFIGURATION",
      "Streaming byte limit must be a positive safe integer.",
    );
  }
}
