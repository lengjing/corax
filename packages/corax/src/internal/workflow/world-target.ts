/**
 * Maps a configured workflow world target to its package import specifier,
 * `"local"` selects the bundled local implementation; other self-hosted
 * worlds use their installed package specifier.
 */
export function resolveWorkflowWorldImport(targetWorld: string): string {
  if (targetWorld === "local") return "@workflow/world-local";
  if (targetWorld === "vercel" || targetWorld === "@workflow/world-vercel") {
    throw new Error(
      "Hosted workflow worlds are not supported by corax. Select local or an installed self-hosted World package.",
    );
  }
  return targetWorld;
}
