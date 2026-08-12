import { normalizeSchoolName } from "./normalize.js";
import {
  CanonicalSchoolSchema,
  SchoolAliasRegistrySchema,
  type CanonicalSchool,
  type SchoolAliasRegistry,
} from "./types.js";

export function canonicalizeSchool(
  value: string,
  aliases: SchoolAliasRegistry,
): CanonicalSchool {
  const registry = SchoolAliasRegistrySchema.parse(aliases);
  const normalized = normalizeSchoolName(value);
  const alias = registry.aliases.find(
    (candidate) => normalizeSchoolName(candidate.alias) === normalized,
  );

  if (alias !== undefined) {
    const canonical = registry.canonicals.find(
      (candidate) => candidate.canonicalId === alias.canonicalId,
    )!;
    return CanonicalSchoolSchema.parse({
      registryVersion: registry.registryVersion,
      matchedAlias: alias.alias,
      canonicalId: canonical.canonicalId,
      canonicalName: canonical.canonicalName,
    });
  }

  return CanonicalSchoolSchema.parse({
    registryVersion: registry.registryVersion,
    matchedAlias: null,
    canonicalId: `unknown-school:${encodeURIComponent(normalized)}`,
    canonicalName: normalized,
  });
}
