export interface PageReferenceSet {
  ordered: string[];
  characters: string[];
  props: string[];
  scenes: string[];
}

export type ImageReferenceInput = string[] | PageReferenceSet;

const unique = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
};

export function selectImageReferences(
  input: ImageReferenceInput,
  maxCount?: number,
): string[] {
  const ordered = unique(Array.isArray(input) ? input : input.ordered);
  if (maxCount === undefined || ordered.length <= maxCount) return ordered;

  const limit = Math.max(0, Math.floor(maxCount));
  if (Array.isArray(input)) return ordered.slice(0, limit);
  if (limit === 0) return [];

  const characters = unique(input.characters);
  const props = unique(input.props).filter(value => !characters.includes(value));
  const scenes = unique(input.scenes).filter(
    value => !characters.includes(value) && !props.includes(value),
  );
  if (limit === 1) {
    const only = characters[0] || scenes[0] || props[0];
    return only ? [only] : [];
  }

  const reserveScene = scenes[0];
  const selected = characters.slice(0, limit - (reserveScene ? 1 : 0));
  if (reserveScene) selected.push(reserveScene);
  for (const candidate of [...props, ...scenes.slice(1)]) {
    if (selected.length >= limit) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected;
}
