/**
 * The namespace of the tools corax adds to sessions itself, such as
 * `corax__search` and `corax__task_wait`.
 */
const CORAX_NAMESPACE = "corax";

/**
 * Why `name` is taken, for errors to quote; undefined when the name is free.
 * Nothing authored or dynamic may be named `corax` or start with `corax__`: a
 * connection or extension named `corax` would own every `corax__` name.
 */
export function coraxNamespaceReservation(name: string): string | undefined {
  return name === CORAX_NAMESPACE || name.startsWith(`${CORAX_NAMESPACE}__`)
    ? `corax reserves the "${CORAX_NAMESPACE}" namespace for its built-in tools`
    : undefined;
}
