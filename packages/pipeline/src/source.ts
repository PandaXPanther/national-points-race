import { z } from "zod";

export const SourceClassSchema = z.enum([
  "structured-official-export",
  "organizer-json-csv",
  "organizer-html-pdf",
  "written-authorized-feed",
]);

export const SourcePermissionSchema = z.enum([
  "official-public-export",
  "official-public-document",
  "written-authorization",
]);

export const SourceDescriptorSchema = z
  .object({
    id: z.string().min(1),
    sourceClass: SourceClassSchema,
    allowlistedHostnames: z.array(z.string().min(1)).min(1).readonly(),
    allowedMediaTypes: z.array(z.string().min(1)).min(1).readonly(),
    permission: SourcePermissionSchema,
  })
  .strict()
  .readonly();

export const SourceSnapshotSchema = z
  .object({
    id: z.string().min(1),
    descriptorId: z.string().min(1),
    url: z.string().url(),
    retrievedAt: z.string().datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().min(1),
    parserVersion: z.string().min(1),
    permission: SourcePermissionSchema,
  })
  .strict()
  .readonly();

export type SourceClass = z.infer<typeof SourceClassSchema>;
export type SourcePermission = z.infer<typeof SourcePermissionSchema>;
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;
