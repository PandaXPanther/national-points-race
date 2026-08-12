import { sha256Hex } from "../crypto/sha256.js";
import { normalizePersonName } from "./normalize.js";
import { canonicalizeSchool } from "./school.js";
import {
  IdentityResolutionInputSchema,
  IdentityResolutionOutputSchema,
  type CanonicalSchool,
  type IdentityDiagnostic,
  type IdentityEvidence,
  type IdentityResolutionInput,
  type IdentityResolutionOutput,
  type SourcePerson,
} from "./types.js";

export type IdentityResolutionErrorCode =
  | "IDENTITY_EDGE_DANGLING"
  | "IDENTITY_EDGE_SELF"
  | "IDENTITY_EDGE_DUPLICATE"
  | "IDENTITY_EDGE_CONFLICT";

export class IdentityResolutionError extends Error {
  readonly code: IdentityResolutionErrorCode;

  constructor(code: IdentityResolutionErrorCode, message: string) {
    super(message);
    this.name = "IdentityResolutionError";
    this.code = code;
  }
}

interface PersonEvidence {
  readonly id: number;
  readonly person: SourcePerson;
  readonly normalizedName: string;
  readonly school: CanonicalSchool;
  readonly sourcePersonKey: string | null;
  readonly stableSortKey: string;
}

class Components {
  readonly parent: number[];
  readonly members: Map<number, Set<number>>;

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.members = new Map(
      Array.from({ length: size }, (_, index) => [index, new Set([index])]),
    );
  }

  root(id: number): number {
    const parent = this.parent[id]!;
    if (parent === id) return id;
    const root = this.root(parent);
    this.parent[id] = root;
    return root;
  }

  union(left: number, right: number): boolean {
    const leftRoot = this.root(left);
    const rightRoot = this.root(right);
    if (leftRoot === rightRoot) return false;
    const first = Math.min(leftRoot, rightRoot);
    const second = Math.max(leftRoot, rightRoot);
    this.parent[second] = first;
    const firstMembers = this.members.get(first)!;
    for (const member of this.members.get(second)!) firstMembers.add(member);
    this.members.delete(second);
    return true;
  }

  component(id: number): readonly number[] {
    return [...this.members.get(this.root(id))!].sort(
      (left, right) => left - right,
    );
  }

  roots(): readonly number[] {
    return [...this.members.keys()].sort((left, right) => left - right);
  }
}

export function resolveIdentities(
  rawInput: IdentityResolutionInput,
): IdentityResolutionOutput {
  const input = IdentityResolutionInputSchema.parse(rawInput);
  const evidence = [...input.people]
    .map((person) => buildPersonEvidence(person, input.aliases))
    .sort((left, right) =>
      compareStrings(left.stableSortKey, right.stableSortKey),
    )
    .map((value, id) => ({ ...value, id }));
  const components = new Components(evidence.length);
  const diagnostics: IdentityDiagnostic[] = [];

  mergeStableIds(evidence, components, diagnostics);
  mergeExplicitEdges(input, evidence, components);
  emitSchoolConflictAmbiguities(evidence, components, diagnostics);
  mergeExactEvidence(evidence, components, diagnostics);
  mergeFuzzyEvidence(evidence, components, diagnostics);

  const competitors = components.roots().map((root) => {
    const people = components.component(root).map((id) => evidence[id]!);
    const verifiedSourcePersonKeys = uniqueSorted(
      people.flatMap(({ sourcePersonKey }) =>
        sourcePersonKey === null ? [] : [sourcePersonKey],
      ),
    );
    const identityEvidence = people
      .map(toIdentityEvidence)
      .sort(compareIdentityEvidence);
    const hashSeed =
      verifiedSourcePersonKeys[0] ??
      JSON.stringify(
        identityEvidence.map((item) => [
          item.normalizedName,
          item.canonicalSchoolId,
          item.provider,
          item.sourceSnapshotId,
          item.sourceEntryId,
        ]),
      );
    const competitorId = `competitor:${sha256Hex(new TextEncoder().encode(hashSeed))}`;
    const display = [...people].sort((left, right) =>
      compareStrings(left.stableSortKey, right.stableSortKey),
    )[0]!;
    return {
      competitorId,
      displayName: display.person.publishedName,
      displaySchool: display.person.publishedSchool,
      canonicalSchool: display.school,
      verifiedSourcePersonKeys,
      identityEvidence,
    };
  });
  competitors.sort((left, right) =>
    compareStrings(left.competitorId, right.competitorId),
  );

  const mappings = competitors
    .flatMap((competitor) =>
      competitor.verifiedSourcePersonKeys.map((sourcePersonKey) => ({
        sourcePersonKey,
        competitorId: competitor.competitorId,
      })),
    )
    .sort(
      (left, right) =>
        compareStrings(left.sourcePersonKey, right.sourcePersonKey) ||
        compareStrings(left.competitorId, right.competitorId),
    );
  diagnostics.sort(compareDiagnostic);

  return IdentityResolutionOutputSchema.parse({
    mappings,
    competitors,
    diagnostics,
  });
}

function emitSchoolConflictAmbiguities(
  evidence: readonly PersonEvidence[],
  components: Components,
  diagnostics: IdentityDiagnostic[],
): void {
  const roots = components.roots();
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < roots.length;
      rightIndex += 1
    ) {
      const left = roots[leftIndex]!;
      const right = roots[rightIndex]!;
      if (
        !componentsHaveSchoolConflictCandidate(
          left,
          right,
          components,
          evidence,
        )
      ) {
        continue;
      }
      diagnostics.push(
        diagnostic(
          "IDENTITY_AMBIGUOUS",
          [...components.component(left), ...components.component(right)].map(
            (id) => evidence[id]!,
          ),
          "Matching name evidence has different canonical schools and requires an explicit edge.",
        ),
      );
    }
  }
}

function componentsHaveSchoolConflictCandidate(
  left: number,
  right: number,
  components: Components,
  evidence: readonly PersonEvidence[],
): boolean {
  return components.component(left).some((leftId) =>
    components.component(right).some((rightId) => {
      const leftEvidence = evidence[leftId]!;
      const rightEvidence = evidence[rightId]!;
      return (
        leftEvidence.school.canonicalId !== rightEvidence.school.canonicalId &&
        (leftEvidence.normalizedName === rightEvidence.normalizedName ||
          atLeastNinetyEightPercentSimilar(
            leftEvidence.normalizedName,
            rightEvidence.normalizedName,
          ))
      );
    }),
  );
}

function buildPersonEvidence(
  person: SourcePerson,
  aliases: IdentityResolutionInput["aliases"],
): Omit<PersonEvidence, "id"> {
  const normalizedName = normalizePersonName(person.publishedName);
  const school = canonicalizeSchool(person.publishedSchool, aliases);
  const sourcePersonKey = stableSourcePersonKey(person);
  const stableSortKey = JSON.stringify([
    person.provider,
    person.sourceSnapshotId,
    person.sourceEntryId,
    person.publishedName,
    person.publishedSchool,
    person.editionId,
    person.eventId,
    person.division,
    person.simultaneousEntryContext ?? "",
    sourcePersonKey ?? "",
  ]);
  return { person, normalizedName, school, sourcePersonKey, stableSortKey };
}

function stableSourcePersonKey(person: SourcePerson): string | null {
  if (person.sourcePersonId === null) return null;
  return person.sourcePersonId.startsWith(`${person.provider}:`)
    ? person.sourcePersonId
    : `${person.provider}:${person.sourcePersonId}`;
}

function mergeStableIds(
  evidence: readonly PersonEvidence[],
  components: Components,
  diagnostics: IdentityDiagnostic[],
): void {
  const byKey = new Map<string, number[]>();
  for (const item of evidence) {
    if (item.sourcePersonKey === null) continue;
    const group = byKey.get(item.sourcePersonKey) ?? [];
    group.push(item.id);
    byKey.set(item.sourcePersonKey, group);
  }
  for (const key of [...byKey.keys()].sort(compareStrings)) {
    const ids = byKey.get(key)!;
    const first = ids[0]!;
    for (const id of ids.slice(1)) {
      if (hasStableConflict(evidence[first]!, evidence[id]!)) {
        diagnostics.push(
          diagnostic(
            "IDENTITY_STABLE_ID_CONFLICT",
            [evidence[first]!, evidence[id]!],
            "Repeated provider person ID has contradictory published identity evidence.",
          ),
        );
      }
      components.union(first, id);
    }
  }
}

function mergeExplicitEdges(
  input: IdentityResolutionInput,
  evidence: readonly PersonEvidence[],
  components: Components,
): void {
  const byKey = new Map<string, number[]>();
  for (const item of evidence) {
    if (item.sourcePersonKey === null) continue;
    const ids = byKey.get(item.sourcePersonKey) ?? [];
    ids.push(item.id);
    byKey.set(item.sourcePersonKey, ids);
  }
  const seen = new Set<string>();
  const edges = input.explicitEdges
    .map((edge) => {
      const left = minString(
        edge.leftSourcePersonKey,
        edge.rightSourcePersonKey,
      );
      const right =
        left === edge.leftSourcePersonKey
          ? edge.rightSourcePersonKey
          : edge.leftSourcePersonKey;
      return { left, right };
    })
    .sort(
      (left, right) =>
        compareStrings(left.left, right.left) ||
        compareStrings(left.right, right.right),
    );

  for (const edge of edges) {
    if (edge.left === edge.right) {
      throw new IdentityResolutionError(
        "IDENTITY_EDGE_SELF",
        "Explicit identity edges must connect two different source people.",
      );
    }
    const edgeKey = JSON.stringify([edge.left, edge.right]);
    if (seen.has(edgeKey)) {
      throw new IdentityResolutionError(
        "IDENTITY_EDGE_DUPLICATE",
        "Explicit identity edges must be unique after undirected canonicalization.",
      );
    }
    seen.add(edgeKey);
    const leftIds = byKey.get(edge.left);
    const rightIds = byKey.get(edge.right);
    if (leftIds === undefined || rightIds === undefined) {
      throw new IdentityResolutionError(
        "IDENTITY_EDGE_DANGLING",
        "Explicit identity edge references a source person that is not present.",
      );
    }
    const left = leftIds[0]!;
    const right = rightIds[0]!;
    if (
      componentsHaveProviderConflict(
        components.component(left),
        components.component(right),
        evidence,
      ) ||
      componentsContradict(
        components.component(left),
        components.component(right),
        evidence,
      )
    ) {
      throw new IdentityResolutionError(
        "IDENTITY_EDGE_CONFLICT",
        "Explicit identity edge conflicts with source or participation evidence.",
      );
    }
    components.union(left, right);
  }
}

function mergeExactEvidence(
  evidence: readonly PersonEvidence[],
  components: Components,
  diagnostics: IdentityDiagnostic[],
): void {
  const roots = components.roots();
  const graph = new Map<number, Set<number>>(
    roots.map((root) => [root, new Set<number>()]),
  );
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < roots.length;
      rightIndex += 1
    ) {
      const left = roots[leftIndex]!;
      const right = roots[rightIndex]!;
      if (!componentsHaveExactEvidence(left, right, components, evidence))
        continue;
      graph.get(left)!.add(right);
      graph.get(right)!.add(left);
    }
  }

  const visited = new Set<number>();
  for (const root of roots) {
    if (visited.has(root) || graph.get(root)!.size === 0) continue;
    const cluster: number[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      cluster.push(current);
      for (const candidate of graph.get(current)!) pending.push(candidate);
    }
    cluster.sort((left, right) => left - right);
    const memberIds = cluster.flatMap((value) => components.component(value));
    if (componentHasInternalContradiction(memberIds, evidence)) {
      diagnostics.push(
        diagnostic(
          "IDENTITY_AMBIGUOUS",
          memberIds.map((id) => evidence[id]!),
          "Exact name and school evidence would bridge contradictory participation.",
        ),
      );
      continue;
    }
    const first = cluster[0]!;
    for (const candidate of cluster.slice(1))
      components.union(first, candidate);
  }
}

function mergeFuzzyEvidence(
  evidence: readonly PersonEvidence[],
  components: Components,
  diagnostics: IdentityDiagnostic[],
): void {
  const roots = components.roots();
  const candidateMap = new Map<number, Set<number>>(
    roots.map((root) => [root, new Set<number>()]),
  );
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < roots.length;
      rightIndex += 1
    ) {
      const left = roots[leftIndex]!;
      const right = roots[rightIndex]!;
      if (
        componentsContradict(
          components.component(left),
          components.component(right),
          evidence,
        )
      ) {
        continue;
      }
      if (!componentsHaveFuzzyEvidence(left, right, components, evidence))
        continue;
      candidateMap.get(left)!.add(right);
      candidateMap.get(right)!.add(left);
    }
  }
  const pairs: { left: number; right: number }[] = [];
  for (const left of roots) {
    const candidates = [...candidateMap.get(left)!];
    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        diagnostics.push(
          diagnostic(
            "IDENTITY_AMBIGUOUS",
            [left, ...candidates].flatMap((root) =>
              components.component(root).map((id) => evidence[id]!),
            ),
            "Fuzzy name evidence has more than one qualifying candidate.",
          ),
        );
      }
      continue;
    }
    const right = candidates[0]!;
    if (
      left < right &&
      candidateMap.get(right)!.size === 1 &&
      candidateMap.get(right)!.has(left)
    ) {
      pairs.push({ left, right });
    }
  }
  for (const pair of pairs) components.union(pair.left, pair.right);
}

function componentsHaveExactEvidence(
  left: number,
  right: number,
  components: Components,
  evidence: readonly PersonEvidence[],
): boolean {
  return components.component(left).some((leftId) =>
    components.component(right).some((rightId) => {
      const leftEvidence = evidence[leftId]!;
      const rightEvidence = evidence[rightId]!;
      return (
        leftEvidence.normalizedName === rightEvidence.normalizedName &&
        leftEvidence.school.canonicalId === rightEvidence.school.canonicalId
      );
    }),
  );
}

function componentsHaveFuzzyEvidence(
  left: number,
  right: number,
  components: Components,
  evidence: readonly PersonEvidence[],
): boolean {
  return components.component(left).some((leftId) =>
    components.component(right).some((rightId) => {
      const leftEvidence = evidence[leftId]!;
      const rightEvidence = evidence[rightId]!;
      return (
        leftEvidence.school.canonicalId === rightEvidence.school.canonicalId &&
        leftEvidence.normalizedName !== rightEvidence.normalizedName &&
        atLeastNinetyEightPercentSimilar(
          leftEvidence.normalizedName,
          rightEvidence.normalizedName,
        )
      );
    }),
  );
}

function atLeastNinetyEightPercentSimilar(
  left: string,
  right: string,
): boolean {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  const maximumLength = Math.max(leftCharacters.length, rightCharacters.length);
  const distance = levenshteinDistance(leftCharacters, rightCharacters);
  return 100 * (maximumLength - distance) >= 98 * maximumLength;
}

function levenshteinDistance(
  left: readonly string[],
  right: readonly string[],
): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index]!;
    }
  }
  return previous[right.length]!;
}

function componentsContradict(
  left: readonly number[],
  right: readonly number[],
  evidence: readonly PersonEvidence[],
): boolean {
  return left.some((leftId) =>
    right.some((rightId) =>
      simultaneousContradiction(evidence[leftId]!, evidence[rightId]!),
    ),
  );
}

function componentsHaveProviderConflict(
  left: readonly number[],
  right: readonly number[],
  evidence: readonly PersonEvidence[],
): boolean {
  const leftKeysByProvider = sourceKeysByProvider(left, evidence);
  const rightKeysByProvider = sourceKeysByProvider(right, evidence);
  for (const [provider, leftKeys] of leftKeysByProvider) {
    const rightKeys = rightKeysByProvider.get(provider);
    if (rightKeys === undefined) continue;
    if (new Set([...leftKeys, ...rightKeys]).size > 1) return true;
  }
  return false;
}

function sourceKeysByProvider(
  members: readonly number[],
  evidence: readonly PersonEvidence[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  for (const member of members) {
    const item = evidence[member]!;
    if (item.sourcePersonKey === null) continue;
    const keys = result.get(item.person.provider) ?? new Set<string>();
    keys.add(item.sourcePersonKey);
    result.set(item.person.provider, keys);
  }
  return result;
}

function componentHasInternalContradiction(
  members: readonly number[],
  evidence: readonly PersonEvidence[],
): boolean {
  for (let left = 0; left < members.length; left += 1) {
    for (let right = left + 1; right < members.length; right += 1) {
      if (
        simultaneousContradiction(
          evidence[members[left]!]!,
          evidence[members[right]!]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function simultaneousContradiction(
  left: PersonEvidence,
  right: PersonEvidence,
): boolean {
  if (left.person.sourceEntryId === right.person.sourceEntryId) return false;
  const sameEvent =
    left.person.editionId === right.person.editionId &&
    left.person.eventId === right.person.eventId &&
    left.person.division === right.person.division;
  const sharedContext =
    left.person.simultaneousEntryContext !== null &&
    left.person.simultaneousEntryContext ===
      right.person.simultaneousEntryContext;
  return sameEvent || sharedContext;
}

function hasStableConflict(
  left: PersonEvidence,
  right: PersonEvidence,
): boolean {
  return (
    left.normalizedName !== right.normalizedName ||
    simultaneousContradiction(left, right)
  );
}

function diagnostic(
  code: IdentityDiagnostic["code"],
  evidence: readonly PersonEvidence[],
  explanation: string,
): IdentityDiagnostic {
  return {
    code,
    severity: code === "IDENTITY_STABLE_ID_CONFLICT" ? "error" : "warning",
    sourcePersonKeys: uniqueSorted(
      evidence.flatMap(({ sourcePersonKey }) =>
        sourcePersonKey === null ? [] : [sourcePersonKey],
      ),
    ),
    sourceEntryIds: uniqueSorted(
      evidence.map(({ person }) => person.sourceEntryId),
    ),
    explanation,
  };
}

function toIdentityEvidence(person: PersonEvidence): IdentityEvidence {
  return {
    normalizedName: person.normalizedName,
    canonicalSchoolId: person.school.canonicalId,
    provider: person.person.provider,
    sourceSnapshotId: person.person.sourceSnapshotId,
    sourceEntryId: person.person.sourceEntryId,
  };
}

function compareIdentityEvidence(
  left: IdentityEvidence,
  right: IdentityEvidence,
): number {
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function compareDiagnostic(
  left: IdentityDiagnostic,
  right: IdentityDiagnostic,
): number {
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function minString(left: string, right: string): string {
  return compareStrings(left, right) <= 0 ? left : right;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}
