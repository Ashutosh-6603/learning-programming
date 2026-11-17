/** Shared by the browser and the dev server: a save that fails this must never replace a real one. */
export function isProgressShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const save = value as Record<string, unknown>;
  const isRecord = (field: unknown) => typeof field === 'object' && field !== null;
  return (
    save['version'] === 1 &&
    isRecord(save['ticks']) &&
    isRecord(save['steps']) &&
    isRecord(save['links']) &&
    isRecord(save['patches'])
  );
}
