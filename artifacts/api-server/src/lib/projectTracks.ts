/**
 * Project track rows outlive arrangement versions: selecting a candidate that
 * drops a family (v2 had drums, v4 does not) leaves the old row in place. The
 * mix/master revision and the export must render the arrangement's own
 * TrackModels one-to-one, so every consumer narrows the project's rows to the
 * ones the arrangement actually carries, and selection mutes the rest so the
 * studio shows them for what they are.
 */
export function arrangementTrackRows<T extends { id: string }>(
  projectTracks: readonly T[],
  trackModels: ReadonlyArray<{ id: string }> | null | undefined,
): T[] {
  const ids = new Set((trackModels ?? []).map((model) => model.id));
  return projectTracks.filter((track) => ids.has(track.id));
}

/** Track rows the new arrangement does not carry: retired, not deleted. */
export function retiredTrackIds(
  projectTracks: ReadonlyArray<{ id: string }>,
  trackModels: ReadonlyArray<{ id: string }> | null | undefined,
): string[] {
  const ids = new Set((trackModels ?? []).map((model) => model.id));
  return projectTracks.filter((track) => !ids.has(track.id)).map((track) => track.id);
}
