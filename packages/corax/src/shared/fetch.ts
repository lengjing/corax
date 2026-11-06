/** Preserve the standard fetch signature when wrapping the request function. */
export function asFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return implementation;
}
