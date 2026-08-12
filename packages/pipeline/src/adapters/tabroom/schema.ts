import { z } from "zod";

const ProviderIdSchema = z
  .union([z.string().min(1), z.number().int().safe()])
  .transform((value) => String(value));

const ProviderResultSchema = z
  .object({
    entry: ProviderIdSchema,
    place: z.union([z.string(), z.number().int().safe()]).nullish(),
    round: ProviderIdSchema.nullish(),
    values: z.array(z.unknown()).optional(),
  })
  .passthrough();

const ProviderResultSetSchema = z
  .object({
    label: z.string().min(1),
    tag: z.string().min(1).optional(),
    bracket: z.union([z.string(), z.number().int().safe()]).optional(),
    published: z.union([z.boolean(), z.number().int().safe()]),
    generated: z.string().min(1).optional(),
    results: z.array(ProviderResultSchema),
  })
  .passthrough();

const ProviderRoundSchema = z
  .object({
    id: ProviderIdSchema,
    label: z.string().min(1).nullish(),
    type: z.string().min(1).nullish(),
    sections: z.array(z.unknown()),
  })
  .passthrough();

const ProviderEventSchema = z
  .object({
    id: ProviderIdSchema,
    name: z.string().min(1),
    rounds: z.array(ProviderRoundSchema),
    result_sets: z.array(ProviderResultSetSchema),
  })
  .passthrough();

const ProviderCategorySchema = z
  .object({
    id: ProviderIdSchema,
    events: z.array(ProviderEventSchema),
  })
  .passthrough();

const ProviderStudentSchema = z
  .object({
    id: ProviderIdSchema,
    first: z.string().min(1),
    last: z.string().min(1),
  })
  .passthrough();

const ProviderEntrySchema = z
  .object({
    id: ProviderIdSchema,
    event: ProviderIdSchema,
    students: z.array(ProviderIdSchema).min(1),
    name: z.string().min(1),
  })
  .passthrough();

const ProviderSchoolSchema = z
  .object({
    id: ProviderIdSchema,
    name: z.string().min(1),
    entries: z.array(ProviderEntrySchema),
    students: z.array(ProviderStudentSchema),
  })
  .passthrough();

export const TabroomExportSchema = z
  .object({
    id: ProviderIdSchema,
    categories: z.array(ProviderCategorySchema),
    schools: z.array(ProviderSchoolSchema),
  })
  .passthrough();

export type TabroomExport = z.infer<typeof TabroomExportSchema>;
