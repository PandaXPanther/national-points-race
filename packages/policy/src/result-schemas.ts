import { z } from "zod";

export const DivisionSchema = z.enum(["combined", "ix", "usx"]);

export const RoundStageSchema = z.enum([
  "octafinal",
  "quarterfinal",
  "semifinal",
  "final",
]);
