import { z } from "zod";

export const DiagnosticSeveritySchema = z.enum(["info", "warning", "error"]);

export const DiagnosticSchema = z
  .object({
    code: z.string().min(1),
    severity: DiagnosticSeveritySchema,
    editionId: z.string().min(1),
    sourceSnapshotId: z.string().min(1),
    explanation: z.string().min(1),
  })
  .strict()
  .readonly();

export type DiagnosticSeverity = z.infer<typeof DiagnosticSeveritySchema>;
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
