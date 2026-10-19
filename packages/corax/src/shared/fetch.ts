/** Keep Bun's fetch extension when wrapping the standard request function. */
export function asFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return Object.assign(implementation, { preconnect: globalThis.fetch.preconnect });
}
